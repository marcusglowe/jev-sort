import jevSort from 'jev-sort';

const emails = [
  { subject: 'Production is down', snippet: 'The API has failed for ten minutes.' },
  { subject: 'Lunch next week?', snippet: 'Are you free on Tuesday?' },
  { subject: 'Invoice approval', snippet: 'Please approve by 4 p.m. today.' },
  { subject: 'Newsletter', snippet: 'This week in design systems...' },
];

const orderingRule = `Place earlier the email where delaying attention has greater
consequences, then the email with an explicit deadline or requested action.`;

const result = await jevSort(emails, async pairs => {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state: {
        ordering_rule: orderingRule,
        pairs: Object.fromEntries(pairs.map(pair => [pair.id, {
          email_a: pair.left,
          email_b: pair.right,
        }])),
      },
      questions: Object.fromEntries(pairs.map(pair => [pair.id, {
        type: 'choice',
        instructions: 'Which email belongs earlier according to `ordering_rule`?',
        criteria: {
          left: 'Email A belongs earlier.',
          right: 'Email B belongs earlier.',
        },
      }])),
    }),
  });

  if (!response.ok) throw new Error(`TypeSafe returned ${response.status}`);
  const payload = await response.json();
  return Object.fromEntries(
    pairs.map(pair => [pair.id, payload.answers[pair.id].choice]),
  );
});

console.log(result.items);
console.log(result.stats);
