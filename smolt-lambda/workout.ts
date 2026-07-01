import { randomUUID } from 'crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db.js';
import { resolveSession } from './auth.js';
import { err, json, parseBody, type LambdaEvent, type LambdaResult } from './http.js';

// ── SL5×5 constants (matches Go app) ────────────────────────────────────────

const EXERCISES = {
  Squat:          { defaultWeight: 45,  incrementLb: 2.5,  sets: 5, reps: 5 },
  'Bench Press':  { defaultWeight: 45,  incrementLb: 2.5,  sets: 5, reps: 5 },
  'Barbell Row':  { defaultWeight: 65,  incrementLb: 2.5,  sets: 5, reps: 5 },
  OHP:            { defaultWeight: 45,  incrementLb: 2.5,  sets: 5, reps: 5 },
  Deadlift:       { defaultWeight: 95,  incrementLb: 5.0,  sets: 1, reps: 5 },
} as const;

type ExerciseName = keyof typeof EXERCISES;

const WORKOUT_A: ExerciseName[] = ['Squat', 'Bench Press', 'Barbell Row'];
const WORKOUT_B: ExerciseName[] = ['Squat', 'OHP', 'Deadlift'];

// Increments are doubled in imperial (Go: progressionIncrementForExercise)
function incrementFor(name: string): number {
  const ex = EXERCISES[name as ExerciseName];
  return ex ? ex.incrementLb * 2 : 5.0;
}

function canonicalName(name: string): string {
  const idx = name.indexOf(' @@');
  return (idx >= 0 ? name.slice(0, idx) : name).trim();
}

// ── DynamoDB helpers ─────────────────────────────────────────────────────────

interface Progress {
  currentWeight: number;
  incrementBy: number;
  failStreak: number;
  skipNextIncrement: boolean;
}

async function loadProgress(userId: string): Promise<Record<string, Progress>> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':pre': 'PROGRESS#' },
    }),
  );
  const out: Record<string, Progress> = {};
  for (const item of result.Items ?? []) {
    out[item.sk.slice('PROGRESS#'.length)] = item as Progress;
  }
  return out;
}

async function sessionLookup(
  sessionId: string,
  userId: string,
): Promise<{ userSk: string } | null> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: 'SESSION' } }),
  );
  if (!Item || Item.userId !== userId) return null;
  return { userSk: Item.userSk };
}

async function loadSessionItem(userId: string, userSk: string): Promise<Record<string, any> | null> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `USER#${userId}`, sk: userSk } }),
  );
  return Item ?? null;
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /api/workout/next
export async function nextWorkout(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const recentSessions = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
      ScanIndexForward: false,
      Limit: 20,
    }),
  );

  let lastProgram = '';
  for (const item of recentSessions.Items ?? []) {
    if (item.finishedAt) { lastProgram = item.workoutName; break; }
  }

  const program = lastProgram === 'A' ? 'B' : 'A';
  const exercises = program === 'A' ? WORKOUT_A : WORKOUT_B;
  const progress = await loadProgress(s.userId);

  return json(200, {
    program,
    exercises: exercises.map(name => ({
      name,
      weight: progress[name]?.currentWeight ?? EXERCISES[name].defaultWeight,
      sets: EXERCISES[name].sets,
      targetReps: EXERCISES[name].reps,
    })),
  });
}

// GET /api/workout/sessions
export async function listSessions(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
      ScanIndexForward: false,
    }),
  );

  const sessions = (result.Items ?? []).map(item => ({
    sessionId: item.sessionId,
    workoutName: item.workoutName,
    createdAt: item.createdAt,
    finishedAt: item.finishedAt ?? null,
    notes: item.notes ?? '',
    setCount: (item.sets ?? []).length,
  }));

  return json(200, { sessions });
}

// POST /api/workout/sessions
export async function startSession(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const body = parseBody(event);
  const workoutType: string = (body.workoutType ?? 'next').toLowerCase();
  const programArg: string = (body.programName ?? '').toUpperCase();

  let program: string;
  let exercises: ExerciseName[];

  if (workoutType === 'program' && (programArg === 'A' || programArg === 'B')) {
    program = programArg;
    exercises = program === 'A' ? WORKOUT_A : WORKOUT_B;
  } else {
    // Determine next from last finished session
    const recent = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
        ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
        ScanIndexForward: false,
        Limit: 20,
      }),
    );
    let last = '';
    for (const item of recent.Items ?? []) {
      if (item.finishedAt) { last = item.workoutName; break; }
    }
    program = last === 'A' ? 'B' : 'A';
    exercises = program === 'A' ? WORKOUT_A : WORKOUT_B;
  }

  const progress = await loadProgress(s.userId);
  const sets: SessionSet[] = [];
  let setNum = 0;

  for (const name of exercises) {
    const ex = EXERCISES[name];
    const weight = progress[name]?.currentWeight ?? ex.defaultWeight;
    for (let i = 0; i < ex.sets; i++) {
      sets.push({ exerciseName: name, setNumber: ++setNum, targetReps: ex.reps, weight });
    }
  }

  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const userSk = `SESSION#${now}#${sessionId}`;

  await Promise.all([
    ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${s.userId}`, sk: userSk, sessionId, workoutName: program, createdAt: now, sets },
    })),
    ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `SESSION#${sessionId}`, sk: 'SESSION', userId: s.userId, userSk },
    })),
  ]);

  return json(201, { sessionId, workoutName: program, createdAt: now, sets });
}

// GET /api/workout/sessions/:id
export async function getSession(event: LambdaEvent, sessionId: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const ref = await sessionLookup(sessionId, s.userId);
  if (!ref) return err(404, 'Session not found');

  const item = await loadSessionItem(s.userId, ref.userSk);
  if (!item) return err(404, 'Session not found');

  return json(200, {
    sessionId,
    workoutName: item.workoutName,
    createdAt: item.createdAt,
    finishedAt: item.finishedAt ?? null,
    notes: item.notes ?? '',
    sets: item.sets ?? [],
  });
}

// POST /api/workout/sessions/:id/sets  — bulk save set results
export async function saveSets(event: LambdaEvent, sessionId: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const ref = await sessionLookup(sessionId, s.userId);
  if (!ref) return err(404, 'Session not found');

  const body = parseBody(event);
  const sets: SessionSet[] = body.sets ?? [];

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `USER#${s.userId}`, sk: ref.userSk },
      UpdateExpression: 'SET sets = :sets',
      ExpressionAttributeValues: { ':sets': sets },
    }),
  );

  return json(200, { ok: true });
}

// POST /api/workout/sessions/:id/finish
export async function finishSession(event: LambdaEvent, sessionId: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const ref = await sessionLookup(sessionId, s.userId);
  if (!ref) return err(404, 'Session not found');

  const item = await loadSessionItem(s.userId, ref.userSk);
  if (!item) return err(404, 'Session not found');

  // Merge any final set updates from request body
  const body = parseBody(event);
  let sets: SessionSet[] = item.sets ?? [];
  if (Array.isArray(body.sets) && body.sets.length > 0) {
    const updates = new Map(body.sets.map((u: SessionSet) => [u.setNumber, u]));
    sets = sets.map(set => {
      const u = updates.get(set.setNumber);
      return u ? { ...set, ...u } : set;
    });
  }

  const progressUpdates: ProgressUpdate[] = [];

  // Apply SL5×5 progression only for standard A/B workouts not yet finished
  if ((item.workoutName === 'A' || item.workoutName === 'B') && !item.finishedAt) {
    const allComplete = sets.every(set => set.completed);
    if (allComplete) {
      const progress = await loadProgress(s.userId);
      const groups = groupByExercise(sets);
      const writes: Promise<any>[] = [];

      for (const [exerciseName, exSets] of groups) {
        const p = progress[exerciseName];
        if (!p) continue;

        const allHitTarget = exSets.every(set => (set.actualReps ?? 0) >= set.targetReps);
        const lastWeight = exSets[exSets.length - 1].weight;
        const base = lastWeight || p.currentWeight;
        const increment = p.incrementBy || incrementFor(exerciseName);

        let newWeight: number;
        let action: string;
        let newFailStreak: number;
        let skipNext = false;

        if (allHitTarget) {
          if (p.skipNextIncrement) {
            newWeight = base; action = 'unchanged';
          } else {
            newWeight = base + increment; action = 'increased';
          }
          newFailStreak = 0;
        } else {
          newFailStreak = (p.failStreak ?? 0) + 1;
          if (newFailStreak >= 3) {
            // Deload: 90% rounded down to nearest 5lb
            newWeight = Math.floor((base * 0.9) / 5) * 5;
            action = 'deload'; newFailStreak = 0;
          } else {
            newWeight = base; action = 'unchanged';
          }
        }

        writes.push(ddb.send(new PutCommand({
          TableName: TABLE,
          Item: {
            pk: `USER#${s.userId}`, sk: `PROGRESS#${exerciseName}`,
            currentWeight: newWeight, incrementBy: increment,
            failStreak: newFailStreak, skipNextIncrement: skipNext,
          },
        })));

        progressUpdates.push({ exerciseName, oldWeight: base, newWeight, action });
      }

      await Promise.all(writes);
    }
  }

  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `USER#${s.userId}`, sk: ref.userSk },
      UpdateExpression: 'SET finishedAt = :fa, sets = :sets',
      ExpressionAttributeValues: { ':fa': now, ':sets': sets },
    }),
  );

  return json(200, { sessionId, progressUpdates });
}

// DELETE /api/workout/sessions/:id
export async function deleteSession(event: LambdaEvent, sessionId: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const ref = await sessionLookup(sessionId, s.userId);
  if (!ref) return err(404, 'Session not found');

  await Promise.all([
    ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SESSION#${sessionId}`, sk: 'SESSION' } })),
    ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `USER#${s.userId}`, sk: ref.userSk } })),
  ]);

  return json(200, { deleted: true });
}

// GET /api/workout/progress
export async function getProgress(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');
  return json(200, { progress: await loadProgress(s.userId) });
}

// POST /api/workout/progress/seed  — onboarding: set starting weights
export async function seedProgress(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const body = parseBody(event);
  const startWeights: Record<string, number> = body.startWeights ?? {};

  await Promise.all(
    Object.entries(EXERCISES).map(([name, ex]) =>
      ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: `USER#${s.userId}`, sk: `PROGRESS#${name}`,
          currentWeight: startWeights[name] ?? ex.defaultWeight,
          incrementBy: incrementFor(name),
          failStreak: 0, skipNextIncrement: false,
        },
      })),
    ),
  );

  return json(200, { ok: true });
}

// GET /api/backup  — full export in smolt BackupData format
export async function exportBackup(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const [progressResult, sessionsResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'PROGRESS#' },
    })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
      ScanIndexForward: true,
    })),
  ]);

  return json(200, {
    version: 1,
    exportedAt: new Date().toISOString(),
    liftProgress: (progressResult.Items ?? []).map(item => ({
      exerciseName: item.sk.slice('PROGRESS#'.length),
      currentWeight: item.currentWeight,
      incrementBy: item.incrementBy,
      failStreak: item.failStreak,
    })),
    sessions: (sessionsResult.Items ?? []).map(item => ({
      workoutName: item.workoutName,
      createdAt: item.createdAt,
      finishedAt: item.finishedAt ?? null,
      notes: item.notes ?? '',
      sets: (item.sets ?? []).map((set: SessionSet) => ({
        exerciseName: set.exerciseName,
        setNumber: set.setNumber,
        targetReps: set.targetReps,
        actualReps: set.actualReps ?? 0,
        weight: set.weight,
        completed: set.completed ?? false,
      })),
    })),
    standaloneWorkouts: [],
  });
}

// POST /api/backup  — full import, replaces all data
export async function importBackup(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const body = parseBody(event);

  // Load existing items to delete
  const [existingProgress, existingSessions] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'PROGRESS#' },
    })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
      ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
    })),
  ]);

  const deletes: Promise<any>[] = [];
  for (const item of existingProgress.Items ?? []) {
    deletes.push(ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: item.pk, sk: item.sk } })));
  }
  for (const item of existingSessions.Items ?? []) {
    deletes.push(ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: item.pk, sk: item.sk } })));
    if (item.sessionId) {
      deletes.push(ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `SESSION#${item.sessionId}`, sk: 'SESSION' } })));
    }
  }
  await Promise.all(deletes);

  // Write imported data
  const writes: Promise<any>[] = [];

  for (const row of body.liftProgress ?? []) {
    if (!row.exerciseName) continue;
    writes.push(ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `USER#${s.userId}`, sk: `PROGRESS#${canonicalName(row.exerciseName)}`,
        currentWeight: row.currentWeight, incrementBy: row.incrementBy,
        failStreak: row.failStreak ?? 0, skipNextIncrement: false,
      },
    })));
  }

  for (const session of body.sessions ?? []) {
    const sessionId = randomUUID();
    const createdAt = session.createdAt ?? new Date().toISOString();
    const userSk = `SESSION#${createdAt}#${sessionId}`;
    writes.push(ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `USER#${s.userId}`, sk: userSk, sessionId,
        workoutName: session.workoutName, createdAt,
        finishedAt: session.finishedAt ?? null,
        notes: session.notes ?? '', sets: session.sets ?? [],
      },
    })));
    writes.push(ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `SESSION#${sessionId}`, sk: 'SESSION', userId: s.userId, userSk },
    })));
  }

  await Promise.all(writes);
  return json(200, { ok: true });
}

// POST /api/workout/progress/:name/deload
export async function deloadExercise(event: LambdaEvent, exerciseName: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `USER#${s.userId}`, sk: `PROGRESS#${exerciseName}` },
  }));
  if (!Item) return err(404, 'Exercise not found');

  const newWeight = Math.floor((Item.currentWeight * 0.9) / 5) * 5;
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { ...Item, currentWeight: newWeight, failStreak: 0 },
  }));
  return json(200, { exerciseName, newWeight });
}

// POST /api/workout/progress/:name/skip
export async function setSkipIncrement(event: LambdaEvent, exerciseName: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const body = parseBody(event);
  const skip: boolean = body.skip === true || body.skip === 'true';

  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `USER#${s.userId}`, sk: `PROGRESS#${exerciseName}` },
  }));
  if (!Item) return err(404, 'Exercise not found');

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { ...Item, skipNextIncrement: skip },
  }));
  return json(200, { exerciseName, skipNextIncrement: skip });
}

// PATCH /api/workout/sessions/:id  — update notes only
export async function patchSession(event: LambdaEvent, sessionId: string): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const ref = await sessionLookup(sessionId, s.userId);
  if (!ref) return err(404, 'Session not found');

  const body = parseBody(event);
  const notes: string = String(body.notes ?? '');

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `USER#${s.userId}`, sk: ref.userSk },
    UpdateExpression: 'SET notes = :notes',
    ExpressionAttributeValues: { ':notes': notes },
  }));
  return json(200, { ok: true });
}

// GET /api/workout/progress/history  — weight-over-time per exercise from finished sessions
export async function progressHistory(event: LambdaEvent): Promise<LambdaResult> {
  const s = await resolveSession(event);
  if (!s) return err(401, 'Not authenticated');

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pre)',
    ExpressionAttributeValues: { ':pk': `USER#${s.userId}`, ':pre': 'SESSION#' },
    ScanIndexForward: true,
  }));

  const history: Record<string, { date: string; weight: number }[]> = {};

  for (const item of result.Items ?? []) {
    if (!item.finishedAt) continue;
    const date: string = (item.finishedAt as string).slice(0, 10);
    const sets: SessionSet[] = item.sets ?? [];

    // Track last-seen weight per exercise (last set in order = working weight)
    const lastWeight: Record<string, number> = {};
    for (const set of sets) {
      const name = canonicalName(set.exerciseName);
      lastWeight[name] = set.weight;
    }

    for (const [name, weight] of Object.entries(lastWeight)) {
      if (!history[name]) history[name] = [];
      history[name].push({ date, weight });
    }
  }

  return json(200, { history });
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SessionSet {
  exerciseName: string;
  setNumber: number;
  targetReps: number;
  actualReps?: number;
  weight: number;
  completed?: boolean;
}

interface ProgressUpdate {
  exerciseName: string;
  oldWeight: number;
  newWeight: number;
  action: string;
}

function groupByExercise(sets: SessionSet[]): Map<string, SessionSet[]> {
  const groups = new Map<string, SessionSet[]>();
  for (const set of sets) {
    const name = canonicalName(set.exerciseName);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(set);
  }
  return groups;
}
