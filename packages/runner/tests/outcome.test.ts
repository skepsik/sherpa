import type { OutboundCommand, OutboundResult } from '@sherpa/contract';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyOutboundOutcome } from '../src/outcome';

void describe('classifyOutboundOutcome', () => {
  void it('success: совместимые исходы', () => {
    assert.equal(
      classifyOutboundOutcome(sendMessage(), {
        commandType: 'send_message',
        type: 'send_ok',
      }),
      'success',
    );
    assert.equal(
      classifyOutboundOutcome(
        {
          buttons: [{ data: 'a', label: 'A' }],
          place: 'p1',
          requestId: 'r1',
          text: 'q',
          type: 'send_question',
        },
        { commandType: 'send_question', messageId: 'm1', type: 'question_ok' },
      ),
      'success',
    );
    assert.equal(
      classifyOutboundOutcome(
        { place: 'p1', title: 't', type: 'create_place' },
        { place: 'p2', type: 'create_place_ok' },
      ),
      'success',
    );
  });

  void it('transport_reject: error с тем же commandType', () => {
    assert.equal(
      classifyOutboundOutcome(sendMessage(), {
        code: 'send_failed',
        commandType: 'send_message',
        message: 'fail',
        type: 'error',
      }),
      'transport_reject',
    );
  });

  void it('protocol_mismatch: несовместимый тип / commandType', () => {
    const cases: { command: OutboundCommand; result: OutboundResult }[] = [
      {
        command: sendMessage(),
        result: {
          commandType: 'set_status',
          type: 'send_ok',
        },
      },
      {
        command: sendMessage(),
        result: {
          commandType: 'send_question',
          messageId: 'm',
          type: 'question_ok',
        },
      },
      {
        command: sendMessage(),
        result: {
          code: 'send_failed',
          commandType: 'set_status',
          message: 'x',
          type: 'error',
        },
      },
      {
        command: {
          place: 'p1',
          title: 't',
          type: 'create_place',
        },
        result: {
          commandType: 'send_message',
          type: 'send_ok',
        },
      },
    ];
    for (const { command, result } of cases) {
      assert.equal(
        classifyOutboundOutcome(command, result),
        'protocol_mismatch',
      );
    }
  });
});

function sendMessage(): OutboundCommand {
  return { place: 'p1', text: 'hi', type: 'send_message' };
}
