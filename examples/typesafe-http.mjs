import { createJevClient } from 'jev-sort';

const emails = [
  { subject: 'Production is down', snippet: 'The API has failed for ten minutes.' },
  { subject: 'Lunch next week?', snippet: 'Are you free on Tuesday?' },
  { subject: 'Invoice approval', snippet: 'Please approve by 4 p.m. today.' },
  { subject: 'Newsletter', snippet: 'This week in design systems...' },
];

const { jevSort } = createJevClient({
  apiKey: process.env.TYPESAFE_API_KEY,
});

const result = await jevSort(
  emails,
  'most urgent even if the sender sounds calm',
);

console.log(result.items);
console.log(result.stats);
