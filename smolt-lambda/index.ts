import { login, logout, me, register, updateProfile } from './auth.js';
import {
  deloadExercise,
  deleteSession,
  exportBackup,
  finishSession,
  getProgress,
  getSession,
  importBackup,
  listSessions,
  nextWorkout,
  patchSession,
  progressHistory,
  saveSets,
  seedProgress,
  setSkipIncrement,
  startSession,
} from './workout.js';
import { err, type LambdaEvent, type LambdaResult } from './http.js';

const ORIGIN_SECRET = process.env.ORIGIN_SECRET!;

export async function handler(event: LambdaEvent): Promise<LambdaResult> {
  if (event.headers['x-origin-secret'] !== ORIGIN_SECRET) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // Extract /api/workout/sessions/:id and sub-paths
  const sessionMatch = path.match(/^\/api\/workout\/sessions\/([^/]+)(\/.*)?$/);
  // Extract /api/workout/progress/:name and sub-paths
  const progressNameMatch = path.match(/^\/api\/workout\/progress\/([^/]+)(\/.*)?$/);

  try {
    // Auth
    if (method === 'GET'  && path === '/api/health')              return { statusCode: 200, body: '{"ok":true}' };
    if (method === 'POST' && path === '/api/register')            return register(event);
    if (method === 'POST' && path === '/api/login')               return login(event);
    if (method === 'POST' && path === '/api/logout')              return logout(event);
    if (method === 'GET'  && path === '/api/me')                  return me(event);
    if (method === 'PUT'  && path === '/api/profile')             return updateProfile(event);

    // Workout
    if (method === 'GET'  && path === '/api/workout/next')              return nextWorkout(event);
    if (method === 'GET'  && path === '/api/workout/sessions')          return listSessions(event);
    if (method === 'POST' && path === '/api/workout/sessions')          return startSession(event);
    if (method === 'GET'  && path === '/api/workout/progress')          return getProgress(event);
    if (method === 'GET'  && path === '/api/workout/progress/history')  return progressHistory(event);
    if (method === 'POST' && path === '/api/workout/progress/seed')     return seedProgress(event);

    // Progress sub-routes: /api/workout/progress/:name/deload | /skip
    if (progressNameMatch) {
      const exName = decodeURIComponent(progressNameMatch[1]);
      const sub = progressNameMatch[2] ?? '';
      if (method === 'POST' && sub === '/deload') return deloadExercise(event, exName);
      if (method === 'POST' && sub === '/skip')   return setSkipIncrement(event, exName);
    }

    // Backup
    if (method === 'GET'  && path === '/api/backup')              return exportBackup(event);
    if (method === 'POST' && path === '/api/backup')              return importBackup(event);

    // Session sub-routes  /api/workout/sessions/:id[/...]
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const sub = sessionMatch[2] ?? '';
      if (method === 'GET'    && sub === '')        return getSession(event, sessionId);
      if (method === 'POST'   && sub === '/sets')   return saveSets(event, sessionId);
      if (method === 'POST'   && sub === '/finish') return finishSession(event, sessionId);
      if (method === 'PATCH'  && sub === '')        return patchSession(event, sessionId);
      if (method === 'DELETE' && sub === '')        return deleteSession(event, sessionId);
    }

    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Internal server error');
  }
}
