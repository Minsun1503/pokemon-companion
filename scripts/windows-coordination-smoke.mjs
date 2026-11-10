import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WindowsAutomation} from '../backend/dist/windows/automation.js';

assert.equal(process.platform, 'win32');
const first = new WindowsAutomation();
const second = new WindowsAutomation();
let finish;
let entered;
const started = new Promise(resolve => {entered = resolve;});
const gate = new Promise(resolve => {finish = resolve;});
try {
  const held = first.withControlLease(async () => {entered(); await gate;});
  await started;
  let otherEntered = false;
  const waiting = second.withControlLease(async () => {otherEntered = true;});
  await delay(250);
  assert.equal(otherEntered, false, 'A second worker entered a held desktop operation.');
  finish();
  await held;
  await waiting;
  assert.equal(otherEntered, true, 'The next worker did not acquire released control.');

  const controller = new AbortController();
  const own = first.withControlLease(async () => {
    const cancelled = second.withControlLease(async () => {throw new Error('Cancelled contender ran.');}, controller.signal);
    const rejected = assert.rejects(cancelled, error => error.details.code === 'CANCELLED');
    await delay(100);
    controller.abort();
    await rejected;
  });
  await own;

  await first.withControlLease(async () => {
    first.close();
    assert.throws(() => first.assertControlLease(), error => error.details.code === 'CONTROL_LEASE_LOST');
    await second.withControlLease(async () => {
      const status = await second.request({action: 'status'});
      assert.equal(status.worker, 'ready');
    });
  });
  console.log('PASS: separate native worker processes exclude entire operations, respect contender cancellation, and recover control after owner termination.');
} finally {
  finish?.();
  first.close();
  second.close();
}
