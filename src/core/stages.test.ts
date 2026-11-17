import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, STAGE_ORDER, isOpen, stageIndex } from './stages.ts';
import type { JobStatus } from './types.ts';

test('advancing from each stage walks the whole line in order', () => {
  const walked: JobStatus[] = ['lead'];
  let current = STAGES.lead.next;
  while (current) {
    walked.push(current);
    current = STAGES[current].next;
  }
  assert.deepEqual(walked, [...STAGE_ORDER]);
});

test('every stage with a next step has a button label, and closed ones have neither', () => {
  for (const [status, info] of Object.entries(STAGES)) {
    assert.equal(info.nextStep === null, info.next === null, status);
    assert.equal(info.advanceLabel === null, info.next === null, status);
  }
});

test('stageIndex and isOpen', () => {
  assert.equal(stageIndex('lead'), 0);
  assert.equal(stageIndex('paid'), 6);
  assert.equal(stageIndex('lost'), -1);
  assert.equal(isOpen('done'), true); // still has to collect payment
  assert.equal(isOpen('paid'), false);
  assert.equal(isOpen('lost'), false);
});
