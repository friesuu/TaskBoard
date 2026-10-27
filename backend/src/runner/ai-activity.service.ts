import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasksService } from '../tasks/tasks.service';
import { BoardsService } from '../boards/boards.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AgentRun } from './agent-run.entity';
import { AgentRunLog } from './agent-run-log.entity';
import { AgentStatus, AgentStatusInfo } from './agent-status.entity';
import { RunnerLogLineDto, RunnerRunFinishDto, RunnerStatusDto } from './runner.dto';
import { redact } from './redact';

// How long without a check-in before the runner counts as offline. It checks in every 30 seconds while
// idle or working, every 2 minutes on battery, at most every 5 minutes while paused and every 10 minutes
// when today's spend cap is used up; each gets a minute or so to spare.
const OFFLINE_AFTER_MINUTES: Record<string, number> = { unplugged: 3, paused: 6, capped: 11 };
const OFFLINE_AFTER_DEFAULT_MINUTES = 2;

// A runaway run can't fill the database: lines past this are dropped
const MAX_LINES_PER_RUN = 5000;

// The runner's activity: its runs (each with a step-by-step log) and what it's doing right now.
// The runner writes it (runner token); you read it (AI tab, AI Activity page). Always your own only.
@Injectable()
export class AiActivityService {
  constructor(
    @InjectRepository(AgentRun)
    private readonly runsRepository: Repository<AgentRun>,
    @InjectRepository(AgentRunLog)
    private readonly logsRepository: Repository<AgentRunLog>,
    @InjectRepository(AgentStatus)
    private readonly statusRepository: Repository<AgentStatus>,
    private readonly tasksService: TasksService,
    private readonly boardsService: BoardsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ----- From the runner -----

  // A step starts on one of your tasks
  async startRun(taskId: number, ownerId: number, step: string, branch: string | null): Promise<AgentRun> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    const board = await this.boardsService.findOwned(task.boardId, ownerId);
    return this.runsRepository.save(this.runsRepository.create({
      taskId: task.id,
      step,
      branch,
      project: board.project ?? null,
      status: 'running',
      result: 'running',
      startedAt: new Date(),
    }));
  }

  // More lines of a running run's log. false = the run already has as many lines as it may.
  async appendLog(runId: number, ownerId: number, lines: RunnerLogLineDto[]): Promise<boolean> {
    const run = await this.runningRun(runId, ownerId);
    const room = MAX_LINES_PER_RUN - (await this.logsRepository.count({ where: { runId: run.id } }));
    if (room <= 0) return false;
    await this.logsRepository.save(lines.slice(0, room).map((line) => this.logsRepository.create({
      runId: run.id,
      at: line.at,
      kind: line.kind,
      text: redact(line.text),
    })));
    return true;
  }

  // The step ended
  async finishRun(runId: number, ownerId: number, input: RunnerRunFinishDto): Promise<AgentRun> {
    const run = await this.runningRun(runId, ownerId);
    run.status = input.status;
    run.result = input.result;
    run.checksPassed = input.checksPassed ?? null;
    run.costUsd = input.costUsd ?? null;
    run.error = input.error ? redact(input.error) : null;
    run.summary = input.summary ? redact(input.summary) : null;
    run.finishedAt = new Date();
    return this.runsRepository.save(run);
  }

  // What the runner is doing now. Reaching the usage limit is worth a notification (once per pause).
  async reportStatus(ownerId: number, input: RunnerStatusDto): Promise<void> {
    const before = await this.statusRepository.findOneBy({ userId: ownerId });
    let taskId = input.taskId ?? null;
    if (taskId !== null) {
      // Only one of your own tasks can be named
      taskId = await this.tasksService.findOwned(taskId, ownerId).then((task) => task.id, () => null);
    }
    const now = new Date();
    const sameState = before !== null && before.state === input.state && before.taskId === taskId;
    await this.statusRepository.save({
      userId: ownerId,
      state: input.state,
      taskId,
      step: input.step ?? null,
      pausedUntil: input.pausedUntil ?? null,
      stateSince: sameState && before ? before.stateSince : now,
      lastSeenAt: now,
    });
    if (input.state === 'paused' && before?.state !== 'paused') {
      await this.notificationsService.notify(ownerId, 'usage_limit', 'Usage limit reached: the runner waits until it resets');
    }
  }

  // ----- For you -----

  // A task's runs, newest first (the AI tab)
  async runsFor(taskId: number, ownerId: number): Promise<AgentRun[]> {
    await this.tasksService.findOwned(taskId, ownerId);
    return this.runsRepository.find({ where: { taskId }, order: { startedAt: 'DESC', id: 'DESC' }, take: 50 });
  }

  // The AI Activity page: your newest runs on every board, optionally only the running, succeeded or
  // failed ones. Each comes with its task's id, title and board (nothing else of the task is needed).
  activity(ownerId: number, status: string | null): Promise<AgentRun[]> {
    const query = this.runsRepository
      .createQueryBuilder('run')
      .innerJoin('run.task', 'task')
      .addSelect(['task.id', 'task.title', 'task.boardId'])
      .where('task.ownerId = :ownerId', { ownerId })
      .orderBy('run.startedAt', 'DESC')
      .addOrderBy('run.id', 'DESC')
      .limit(100);
    if (status) query.andWhere('run.status = :status', { status });
    return query.getMany();
  }

  // One run's step-by-step log, in order
  async runLog(runId: number, ownerId: number): Promise<AgentRunLog[]> {
    await this.ownedRun(runId, ownerId);
    return this.logsRepository.find({ where: { runId }, order: { id: 'ASC' } });
  }

  async agentStatus(ownerId: number): Promise<AgentStatusInfo> {
    const status = await this.statusRepository.findOneBy({ userId: ownerId });
    if (!status) {
      return { state: 'never', task: null, step: null, pausedUntil: null, stateSince: null, lastSeenAt: null };
    }
    const offlineAfterMs = (OFFLINE_AFTER_MINUTES[status.state] ?? OFFLINE_AFTER_DEFAULT_MINUTES) * 60_000;
    const offline = Date.now() - status.lastSeenAt.getTime() > offlineAfterMs;
    const task = !offline && status.taskId !== null
      ? await this.tasksService.findOwned(status.taskId, ownerId).catch(() => null)
      : null;
    return {
      state: offline ? 'offline' : status.state,
      task,
      step: offline ? null : status.step,
      pausedUntil: status.pausedUntil,
      stateSince: status.stateSince,
      lastSeenAt: status.lastSeenAt,
    };
  }

  // A run of one of your tasks. Anyone else's looks exactly like one that doesn't exist.
  private async ownedRun(runId: number, ownerId: number): Promise<AgentRun> {
    const run = await this.runsRepository
      .createQueryBuilder('run')
      .innerJoin('run.task', 'task')
      .where('run.id = :runId AND task.ownerId = :ownerId', { runId, ownerId })
      .getOne();
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  private async runningRun(runId: number, ownerId: number): Promise<AgentRun> {
    const run = await this.ownedRun(runId, ownerId);
    if (run.status !== 'running') throw new BadRequestException(`Run ${runId} has already finished`);
    return run;
  }
}
