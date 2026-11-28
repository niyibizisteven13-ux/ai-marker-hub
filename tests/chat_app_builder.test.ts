import assert from 'node:assert/strict';
import test from 'node:test';
import { chatAppLink, chatAppRequest, featureBuilderEndpoint, isChatAppProject } from '../shared/chatAppBuilder.js';

test('chat accepts app builds and follow-up edits while leaving unrelated chat alone', () => {
  assert.equal(chatAppRequest('Build a booking app with an appointment dashboard', false), true);
  assert.equal(chatAppRequest('/app make a gallery', false), true);
  assert.equal(chatAppRequest('Add search and make the menu smaller', true), true);
  assert.equal(chatAppRequest('Add search and make the menu smaller', false), false);
  assert.equal(chatAppRequest('How do I build a website?', false), false);
  assert.equal(chatAppRequest('Update my Bwenge4Biz app', true), false);
});

test('chat workspace links refer to a validated project and do not overwrite the default workspace', () => {
  assert.equal(isChatAppProject('session-1234'), true);
  assert.equal(isChatAppProject('../someone-else'), false);
  assert.equal(chatAppLink('session-1234'), '/builder?workspace=custom&project=session-1234');
  assert.equal(featureBuilderEndpoint('custom', 'session-1234'), '/api/agent/builder/custom?project=session-1234');
  assert.equal(featureBuilderEndpoint('business', 'session-1234'), '/api/agent/builder/business');
});
