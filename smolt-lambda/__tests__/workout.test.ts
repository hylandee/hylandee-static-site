import { handler } from '../index';
import {
  clearTable,
  makeEvent,
  registerAndLogin,
  runFailedWorkout,
  runFullWorkout,
} from './helpers';

let cookie: string;

beforeEach(async () => {
  await clearTable();
  cookie = await registerAndLogin('testuser', 'testpassword123');
  await handler(makeEvent('POST', '/api/workout/progress/seed', {}, [cookie]));
});

// ── Progress ───────────────────────────────────────────────────────────────────

describe('progress', () => {
  test('seed sets default weights for all 5 exercises', async () => {
    const res = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    expect(res.statusCode).toBe(200);
    const { progress } = JSON.parse(res.body);
    expect(Object.keys(progress)).toHaveLength(5);
    expect(progress['Squat'].currentWeight).toBe(45);
    expect(progress['Bench Press'].currentWeight).toBe(45);
    expect(progress['Barbell Row'].currentWeight).toBe(65);
    expect(progress['OHP'].currentWeight).toBe(45);
    expect(progress['Deadlift'].currentWeight).toBe(95);
  });

  test('getProgress requires auth', async () => {
    const res = await handler(makeEvent('GET', '/api/workout/progress'));
    expect(res.statusCode).toBe(401);
  });

  test('manual deload reduces weight by 10%', async () => {
    const res = await handler(makeEvent('POST', '/api/workout/progress/Squat/deload', {}, [cookie]));
    expect(res.statusCode).toBe(200);
    const progress = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    const { Squat } = JSON.parse(progress.body).progress;
    // floor(45 * 0.9 / 5) * 5 = floor(8.1) * 5 = 40
    expect(Squat.currentWeight).toBe(40);
  });
});

// ── Next workout ───────────────────────────────────────────────────────────────

describe('nextWorkout', () => {
  test('first workout is program A with Squat/Bench/Row', async () => {
    const res = await handler(makeEvent('GET', '/api/workout/next', undefined, [cookie]));
    expect(res.statusCode).toBe(200);
    const { program, exercises } = JSON.parse(res.body);
    expect(program).toBe('A');
    const names = exercises.map((e: any) => e.name);
    expect(names).toEqual(['Squat', 'Bench Press', 'Barbell Row']);
  });

  test('after finishing A, next workout is B', async () => {
    await runFullWorkout(cookie);
    const res = await handler(makeEvent('GET', '/api/workout/next', undefined, [cookie]));
    expect(JSON.parse(res.body).program).toBe('B');
  });

  test('nextWorkout requires auth', async () => {
    const res = await handler(makeEvent('GET', '/api/workout/next'));
    expect(res.statusCode).toBe(401);
  });
});

// ── Sessions ───────────────────────────────────────────────────────────────────

describe('sessions', () => {
  test('startSession returns sessionId and 15 sets for workout A', async () => {
    const res = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    expect(res.statusCode).toBe(201);
    const { sessionId, workoutName, sets } = JSON.parse(res.body);
    expect(sessionId).toBeTruthy();
    expect(workoutName).toBe('A');
    // 5 sets × 3 exercises = 15
    expect(sets).toHaveLength(15);
  });

  test('startSession requires auth', async () => {
    const res = await handler(makeEvent('POST', '/api/workout/sessions'));
    expect(res.statusCode).toBe(401);
  });

  test('getSession returns saved session', async () => {
    const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const { sessionId } = JSON.parse(startRes.body);
    const getRes = await handler(makeEvent('GET', `/api/workout/sessions/${sessionId}`, undefined, [cookie]));
    expect(getRes.statusCode).toBe(200);
    const data = JSON.parse(getRes.body);
    expect(data.sessionId).toBe(sessionId);
    expect(data.workoutName).toBe('A');
    expect(data.sets).toHaveLength(15);
  });

  test('patch saves notes on a session', async () => {
    const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const { sessionId } = JSON.parse(startRes.body);

    const patchRes = await handler(makeEvent('PATCH', `/api/workout/sessions/${sessionId}`, { notes: 'felt strong' }, [cookie]));
    expect(patchRes.statusCode).toBe(200);

    const getRes = await handler(makeEvent('GET', `/api/workout/sessions/${sessionId}`, undefined, [cookie]));
    expect(JSON.parse(getRes.body).notes).toBe('felt strong');
  });

  test('saveSets persists set results mid-workout', async () => {
    const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const { sessionId, sets } = JSON.parse(startRes.body);

    const updated = [{ ...sets[0], completed: true, actualReps: 5 }];
    const saveRes = await handler(makeEvent('POST', `/api/workout/sessions/${sessionId}/sets`, { sets: updated }, [cookie]));
    expect(saveRes.statusCode).toBe(200);
  });

  test('listSessions returns all sessions', async () => {
    await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const res = await handler(makeEvent('GET', '/api/workout/sessions', undefined, [cookie]));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).sessions).toHaveLength(2);
  });

  test('deleteSession removes it', async () => {
    const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const { sessionId } = JSON.parse(startRes.body);
    const delRes = await handler(makeEvent('DELETE', `/api/workout/sessions/${sessionId}`, undefined, [cookie]));
    expect(delRes.statusCode).toBe(200);
    const getRes = await handler(makeEvent('GET', `/api/workout/sessions/${sessionId}`, undefined, [cookie]));
    expect(getRes.statusCode).toBe(404);
  });
});

// ── Progression ────────────────────────────────────────────────────────────────

describe('progression', () => {
  test('finishing all sets increases weights by increment', async () => {
    const finishRes = await runFullWorkout(cookie);
    expect(finishRes.statusCode).toBe(200);
    const { progressUpdates } = JSON.parse(finishRes.body);

    const squat = progressUpdates.find((u: any) => u.exerciseName === 'Squat');
    const bench = progressUpdates.find((u: any) => u.exerciseName === 'Bench Press');
    const row = progressUpdates.find((u: any) => u.exerciseName === 'Barbell Row');

    expect(squat?.action).toBe('increased');
    expect(squat?.oldWeight).toBe(45);
    expect(squat?.newWeight).toBe(50); // 45 + 5

    expect(bench?.newWeight).toBe(50);
    expect(row?.newWeight).toBe(70); // 65 + 5

    // Verify progress was persisted
    const progressRes = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    const { progress } = JSON.parse(progressRes.body);
    expect(progress['Squat'].currentWeight).toBe(50);
  });

  test('finishing without completing all sets skips progression', async () => {
    const startRes = await handler(makeEvent('POST', '/api/workout/sessions', {}, [cookie]));
    const { sessionId } = JSON.parse(startRes.body);

    // Finish with no sets in body — all remain incomplete (completed=undefined → falsy)
    const finishRes = await handler(makeEvent('POST', `/api/workout/sessions/${sessionId}/finish`, {}, [cookie]));
    expect(finishRes.statusCode).toBe(200);
    expect(JSON.parse(finishRes.body).progressUpdates).toHaveLength(0);

    // Weights unchanged
    const progressRes = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    expect(JSON.parse(progressRes.body).progress['Squat'].currentWeight).toBe(45);
  });

  test('3 failed workouts trigger deload on Squat', async () => {
    // Squat appears in A, B, A — that's 3 failures → deload
    await runFailedWorkout(cookie); // workout A
    await runFailedWorkout(cookie); // workout B
    const thirdRes = await runFailedWorkout(cookie); // workout A — Squat hits failStreak=3
    expect(thirdRes.statusCode).toBe(200);

    const { progressUpdates } = JSON.parse(thirdRes.body);
    const squat = progressUpdates.find((u: any) => u.exerciseName === 'Squat');
    expect(squat?.action).toBe('deload');
    // floor(45 * 0.9 / 5) * 5 = 40
    expect(squat?.newWeight).toBe(40);
    expect(squat?.oldWeight).toBe(45);

    // Others (Bench, Row) still at streak=2 → unchanged this session
    const bench = progressUpdates.find((u: any) => u.exerciseName === 'Bench Press');
    expect(bench?.action).toBe('unchanged');
  });

  test('skipNextIncrement leaves weight unchanged then clears', async () => {
    // Mark Squat as skip
    const skipRes = await handler(makeEvent('POST', '/api/workout/progress/Squat/skip', { skip: true }, [cookie]));
    expect(skipRes.statusCode).toBe(200);

    // Run successful workout A
    const finishRes = await runFullWorkout(cookie);
    const { progressUpdates } = JSON.parse(finishRes.body);

    const squat = progressUpdates.find((u: any) => u.exerciseName === 'Squat');
    const bench = progressUpdates.find((u: any) => u.exerciseName === 'Bench Press');
    expect(squat?.action).toBe('unchanged');
    expect(squat?.newWeight).toBe(45); // not increased
    expect(bench?.action).toBe('increased'); // others still advance
    expect(bench?.newWeight).toBe(50);

    // Next successful workout — skip is cleared, Squat should increase now
    const secondFinish = await runFullWorkout(cookie);
    const updates2 = JSON.parse(secondFinish.body).progressUpdates;
    const squat2 = updates2.find((u: any) => u.exerciseName === 'Bench Press');
    // Bench is in workout B, so check Squat in B workout
    const squatInB = updates2.find((u: any) => u.exerciseName === 'Squat');
    if (squatInB) {
      expect(squatInB.action).toBe('increased');
    }
  });
});

// ── Backup / restore ───────────────────────────────────────────────────────────

describe('backup', () => {
  test('export returns progress and sessions', async () => {
    await runFullWorkout(cookie);
    const res = await handler(makeEvent('GET', '/api/backup', undefined, [cookie]));
    expect(res.statusCode).toBe(200);
    const backup = JSON.parse(res.body);
    expect(backup.version).toBe(1);
    expect(backup.liftProgress).toHaveLength(5);
    expect(backup.sessions).toHaveLength(1);
  });

  test('import restores progress weights', async () => {
    // Export after seed (all at defaults)
    const exportRes = await handler(makeEvent('GET', '/api/backup', undefined, [cookie]));
    const originalBackup = JSON.parse(exportRes.body);

    // Run a workout to advance weights
    await runFullWorkout(cookie);
    const afterWorkout = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    expect(JSON.parse(afterWorkout.body).progress['Squat'].currentWeight).toBe(50);

    // Import the original backup
    const importRes = await handler(makeEvent('POST', '/api/backup', originalBackup, [cookie]));
    expect(importRes.statusCode).toBe(200);

    // Weights should be back to defaults
    const restored = await handler(makeEvent('GET', '/api/workout/progress', undefined, [cookie]));
    expect(JSON.parse(restored.body).progress['Squat'].currentWeight).toBe(45);
  });
});
