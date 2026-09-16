/**
 * Les tâches longues de l'interface : récupérer le Dataset, prendre un
 * instantané des sources, construire, contrôler, publier.
 *
 * Une seule à la fois — deux constructions concurrentes écriraient dans les
 * mêmes fichiers — et son journal est gardé en mémoire pour que la page le
 * relise au fil de l'eau, sans rien installer côté navigateur.
 */
import { spawn } from 'node:child_process';

export type JobState = 'running' | 'ok' | 'failed';

export interface Job {
  name: string;
  /** Ce qui est réellement lancé, pour qu'on puisse le relancer à la main. */
  command: string;
  startedAt: string;
  endedAt?: string;
  state: JobState;
  log: string[];
}

/** Au-delà, on coupe : un journal de construction ne sert pas à archiver. */
const MAX_LINES = 2000;

export class JobRunner {
  private job: Job | null = null;

  /** La tâche en cours ou la dernière terminée ; `null` si rien n'a jamais tourné. */
  get current(): Job | null {
    return this.job;
  }

  get busy(): boolean {
    return this.job?.state === 'running';
  }

  start(name: string, cmd: string, args: string[], cwd: string): Job {
    if (this.busy) throw new Error(`une tâche est déjà en cours : ${this.job!.name}`);
    const job: Job = {
      name,
      command: [cmd, ...args].join(' '),
      startedAt: new Date().toISOString(),
      state: 'running',
      log: [],
    };
    this.job = job;

    const push = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        job.log.push(line);
        if (job.log.length > MAX_LINES) job.log.splice(0, job.log.length - MAX_LINES);
      }
    };

    const child = spawn(cmd, args, { cwd, env: process.env });
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => {
      job.log.push(`✘ ${err.message}`);
      job.state = 'failed';
      job.endedAt = new Date().toISOString();
    });
    child.on('close', (code) => {
      if (job.state !== 'running') return;
      job.state = code === 0 ? 'ok' : 'failed';
      job.endedAt = new Date().toISOString();
      job.log.push(code === 0 ? '— terminé' : `— échec (code ${code})`);
    });
    return job;
  }

  /** L'état, et les lignes de journal depuis `since` : la page ne relit jamais tout. */
  report(since = 0): { job: Omit<Job, 'log'> | null; lines: string[]; next: number } {
    if (!this.job) return { job: null, lines: [], next: 0 };
    const { log, ...job } = this.job;
    return { job, lines: log.slice(since), next: log.length };
  }
}
