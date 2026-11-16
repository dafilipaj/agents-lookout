import { serveCall } from './control.ts';

/** What the World's `pmset` says of the power source (AWAKE-3.1); every World is on the charger. */
export interface PmsetDecl {
  power: 'ac' | 'battery';
}

const SOURCE = { ac: 'AC Power', battery: 'Battery Power' } as const;

// AWAKE-3.1: Lookout reads only `pmset -g batt`; anything else is a violation.
await serveCall<PmsetDecl>('pmset', (argv, answer) =>
  argv.join(' ') === '-g batt'
    ? { stdout: `Now drawing from '${SOURCE[answer.power]}'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n`, code: 0 }
    : { refused: 'only `pmset -g batt` is answered' },
);
