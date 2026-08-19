import crypto from 'crypto';
import { AuthorType, Decision, DecisionStatus } from '../domain/types.js';
import { DecisionNotFoundError, MandatoryReasonMissingError } from '../domain/errors.js';
import { IDecisionRepository } from '../infrastructure/repositories/interfaces.js';

export interface RecordDecisionDTO {
  title: string;
  context: string;
  choice: string;
  rationale: string;
  tags?: string[];
  projectPath: string;
  authorId: string;
  authorType?: AuthorType;
}

export class DecisionService {
  constructor(private decisionRepo: IDecisionRepository) {}

  recordDecision(dto: RecordDecisionDTO): Decision {
    const now = new Date().toISOString();
    const decision: Decision = {
      id: `dec-${crypto.randomUUID().slice(0, 8)}`,
      title: dto.title.trim(),
      context: dto.context.trim(),
      choice: dto.choice.trim(),
      rationale: dto.rationale.trim(),
      status: 'accepted',
      tags: dto.tags || [],
      projectPath: dto.projectPath,
      authorId: dto.authorId,
      authorType: dto.authorType || 'agent',
      createdAt: now,
      updatedAt: now,
    };

    return this.decisionRepo.create(decision);
  }

  getDecision(id: string): Decision {
    const dec = this.decisionRepo.findById(id);
    if (!dec) {
      throw new DecisionNotFoundError(id);
    }
    return dec;
  }

  listDecisions(projectPath: string, status?: DecisionStatus, tag?: string): Decision[] {
    return this.decisionRepo.list(projectPath, status, tag);
  }

  supersedeDecision(
    oldDecisionId: string,
    newDecisionDto: RecordDecisionDTO,
    reason: string
  ): { oldDecision: Decision; newDecision: Decision } {
    if (!reason || !reason.trim()) {
      throw new MandatoryReasonMissingError('superseding an architectural decision');
    }

    const oldDecision = this.getDecision(oldDecisionId);
    const newDecision = this.recordDecision(newDecisionDto);

    oldDecision.status = 'superseded';
    oldDecision.supersededById = newDecision.id;
    oldDecision.updatedAt = new Date().toISOString();
    this.decisionRepo.update(oldDecision);

    return {
      oldDecision,
      newDecision,
    };
  }
}
