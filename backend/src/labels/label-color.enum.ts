import { registerEnumType } from '@nestjs/graphql';

// The fixed label palette. No red on purpose: red means "overdue" everywhere in the app.
export enum LabelColor {
  GRAY = 'gray',
  BLUE = 'blue',
  PURPLE = 'purple',
  TEAL = 'teal',
  GREEN = 'green',
  YELLOW = 'yellow',
  ORANGE = 'orange',
  PINK = 'pink',
}

registerEnumType(LabelColor, { name: 'LabelColor' });

// ONE data type with a fixed list of allowed values
