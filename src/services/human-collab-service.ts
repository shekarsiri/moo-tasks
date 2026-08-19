import crypto from 'crypto';
import { Task } from '../domain/types.js';
import { MandatoryReasonMissingError, TaskNotFoundError } from '../domain/errors.js';
import {
  ITaskRepository,
  INoteRepository,
  IStatusHistoryRepository,
} from '../infrastructure/repositories/interfaces.js';

export class HumanCollabService {
  constructor(
    private taskRepo: ITaskRepository,
    private noteRepo: INoteRepository,
    private statusHistoryRepo: IStatusHistoryRepository
  ) {}

  askHuman(
    taskId: string,
    agentId: string,
    question: string,
    questionType: 'clarification' | 'approval' | 'credential' | 'decision' = 'clarification',
    options?: string[]
  ): Task {
    if (!question || !question.trim()) {
      throw new MandatoryReasonMissingError('asking a human question');
    }

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const now = new Date().toISOString();
    const prevStatus = task.status;

    task.status = 'waiting-on-human';
    task.humanQuestion = question.trim();
    task.humanQuestionType = questionType;
    task.humanOptions = options && options.length > 0 ? options : undefined;
    task.humanAnswer = undefined;
    task.humanAnsweredAt = undefined;
    task.humanAnsweredBy = undefined;
    task.updatedAt = now;
    task.lastStateChangeAt = now;

    const updated = this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: 'agent',
      authorId: agentId,
      noteType: 'general',
      content: `❓ Waiting on Human (${questionType}):\n${question.trim()}`,
      createdAt: now,
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus: prevStatus,
      toStatus: 'waiting-on-human',
      changedBy: agentId,
      authorType: 'agent',
      reason: `Blocked waiting on human: ${question.trim()}`,
      timestamp: now,
    });

    return updated;
  }

  answerHuman(taskId: string, humanId: string, answer: string): Task {
    if (!answer || !answer.trim()) {
      throw new MandatoryReasonMissingError('providing human answer');
    }

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const now = new Date().toISOString();
    const prevStatus = task.status;

    task.humanAnswer = answer.trim();
    task.humanAnsweredAt = now;
    task.humanAnsweredBy = humanId;
    task.status = 'todo'; // Resumes ready to be picked up
    task.updatedAt = now;
    task.lastStateChangeAt = now;

    const updated = this.taskRepo.update(task);

    this.noteRepo.create({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      authorType: 'human',
      authorId: humanId,
      noteType: 'general',
      content: `💡 Human Answer from '${humanId}':\n${answer.trim()}`,
      createdAt: now,
    });

    this.statusHistoryRepo.create({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      taskId,
      fromStatus: prevStatus,
      toStatus: 'todo',
      changedBy: humanId,
      authorType: 'human',
      reason: `Human answered question, task unblocked`,
      timestamp: now,
    });

    return updated;
  }

  getHumanInbox(goalId?: string): Task[] {
    const filter: any = { status: 'waiting-on-human', isArchived: false };
    if (goalId) filter.goalId = goalId;
    return this.taskRepo.list(filter);
  }
}
