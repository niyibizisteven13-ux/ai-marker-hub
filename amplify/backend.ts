import { defineBackend } from '@aws-amplify/backend';
import { apiHandler } from './functions/api-handler/resource';

defineBackend({
  apiHandler,
});
