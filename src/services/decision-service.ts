import fs from 'fs';
import path from 'path';
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
  workspaceId?: string;
}

export class DecisionService {
  constructor(private decisionRepo: IDecisionRepository) {}

  recordDecision(dto: RecordDecisionDTO, autoSyncAdr: boolean = true): Decision {
    const now = new Date().toISOString();
    const decision: Decision = {
      id: `dec-${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: dto.workspaceId,
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

    const created = this.decisionRepo.create(decision);

    if (autoSyncAdr && dto.projectPath) {
      try {
        this.syncAdrFiles(dto.projectPath);
      } catch {
        // In-memory / test environment safe fallback
      }
    }

    return created;
  }

  getDecision(id: string): Decision {
    const dec = this.decisionRepo.findById(id);
    if (!dec) {
      throw new DecisionNotFoundError(id);
    }
    return dec;
  }

  listDecisions(projectPath?: string, status?: DecisionStatus, tag?: string, workspaceId?: string): Decision[] {
    return this.decisionRepo.list(projectPath, status, tag, workspaceId);
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
    const newDecision = this.recordDecision(newDecisionDto, false);

    oldDecision.status = 'superseded';
    oldDecision.supersededById = newDecision.id;
    oldDecision.updatedAt = new Date().toISOString();
    this.decisionRepo.update(oldDecision);

    if (newDecisionDto.projectPath) {
      try {
        this.syncAdrFiles(newDecisionDto.projectPath);
      } catch {
        // In-memory / test safe
      }
    }

    return {
      oldDecision,
      newDecision,
    };
  }

  syncAdrFiles(projectPath: string): { writtenCount: number; files: string[] } {
    if (!projectPath || projectPath.startsWith(':memory:')) {
      return { writtenCount: 0, files: [] };
    }

    const allDecisions = this.decisionRepo.list(projectPath);
    if (allDecisions.length === 0) {
      return { writtenCount: 0, files: [] };
    }

    const adrDir = path.join(path.resolve(projectPath), 'docs', 'adr');
    if (!fs.existsSync(adrDir)) {
      fs.mkdirSync(adrDir, { recursive: true });
    }

    // Sort chronologically ascending
    const sorted = [...allDecisions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const writtenFiles: string[] = [];

    sorted.forEach((dec, index) => {
      const numStr = String(index + 1).padStart(4, '0');
      const slug = dec.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const filename = `${numStr}-${slug || dec.id}.md`;
      const filePath = path.join(adrDir, filename);

      const statusLine =
        dec.status === 'superseded' && dec.supersededById
          ? `Superseded by [${dec.supersededById}]`
          : dec.status.toUpperCase();

      const adrMarkdown = [
        `# ${index + 1}. ${dec.title}`,
        ``,
        `* **Status**: ${statusLine}`,
        `* **Decision ID**: \`${dec.id}\``,
        `* **Date**: ${dec.createdAt.split('T')[0]}`,
        `* **Author**: \`${dec.authorId}\` (${dec.authorType})`,
        `* **Tags**: ${dec.tags.length > 0 ? dec.tags.map((t) => `\`${t}\``).join(', ') : 'None'}`,
        ``,
        `## Context`,
        ``,
        dec.context,
        ``,
        `## Decision`,
        ``,
        dec.choice,
        ``,
        `## Rationale & Consequences`,
        ``,
        dec.rationale,
        ``,
      ].join('\n');

      fs.writeFileSync(filePath, adrMarkdown, 'utf-8');
      writtenFiles.push(filePath);
    });

    return {
      writtenCount: writtenFiles.length,
      files: writtenFiles,
    };
  }
}
