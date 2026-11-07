import {connect} from './client.mjs';
const {client, call} = await connect();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.once('SIGINT', async () => { await client.close(); process.exit(0); });
console.log('Pokémon companion demo. Left-click the pet for Switch, Talk, and Exit. Ctrl+C closes it.');
await call('pokemon', {action: 'say', message: 'Pika! Your desktop team is here.'});
await wait(2500);
await call('pokemon', {action: 'task', message: 'Getting ready to help you'});
await wait(3500);
await call('pokemon', {action: 'think', message: 'Thinking about our next adventure…'});
await wait(3500);
await call('pokemon', {action: 'done', message: 'Ready! Tell Claude or Codex what you want to do.'});
// This demo changes only the companion. It does not send computer input.
await new Promise((resolve) => setTimeout(resolve, 30 * 60 * 1000));
await client.close();
