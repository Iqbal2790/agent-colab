import type { ContextPackOptions } from './types.js';
import type { VaultManager } from './vault.js';

export function buildContextPack(
  vault: VaultManager,
  options: ContextPackOptions
): string {
  const profile = vault.getUserProfile();
  const rules = vault.getGlobalRules();
  const noteLimit = options.noteLimit ?? 5;

  const lines: string[] = [];

  if (options.target === 'claude') {
    lines.push(
      '<!-- Agent Colab Context Pack for Claude Chat / Claude Projects -->',
      '# Agent Colab — Shared Context Snapshot',
      '> Paste this into Claude Chat or upload to Claude Projects to continue seamlessly without re-explaining your work.',
      ''
    );
  } else if (options.target === 'gemini') {
    lines.push(
      '<!-- Agent Colab Context Pack for Gemini Web / Gemini Gems -->',
      '# Agent Colab — Gemini Context & Knowledge Pack',
      '> Upload this file to Gemini Gems Knowledge or paste it at the start of a Gemini Web chat.',
      ''
    );
  } else {
    lines.push('# Agent Colab — Context Snapshot', '');
  }

  lines.push(`Generated at: ${new Date().toISOString()}`, '');

  if (profile.content) {
    lines.push('---', '## User Profile', '', profile.content, '');
  }

  if (rules.content) {
    lines.push('---', '## Global Working Rules', '', rules.content, '');
  }

  if (options.projectSlug) {
    const project = vault.getProject(options.projectSlug);
    if (project) {
      lines.push(
        '---',
        `## Active Project: ${project.name} (\`${project.slug}\`)`,
        `- **Status**: ${project.status}`,
        ...(project.tags.length > 0 ? [`- **Tags**: ${project.tags.join(', ')}`] : []),
        ...(project.repoPath ? [`- **Repo Path**: \`${project.repoPath}\``] : []),
        '',
        project.content,
        ''
      );

      if (project.decisions) {
        lines.push('### Key Decisions', '', project.decisions, '');
      }

      const tasks = vault.listTasks(project.slug);
      if (tasks.length > 0) {
        lines.push('### Active & Recent Tasks', '');
        for (const task of tasks) {
          const lockInfo = task.claimedBy ? ` (claimed by \`${task.claimedBy}\`)` : '';
          lines.push(`- **[${task.status.toUpperCase()}]** \`${task.id}\` — ${task.title}${lockInfo}`);
          if (task.body) {
            lines.push(`  > ${task.body.replace(/\n/g, '\n  > ')}`);
          }
        }
        lines.push('');
      }

      const notes = vault.listNotes(project.slug, noteLimit);
      if (notes.length > 0) {
        lines.push('### Latest Agent Handoff Notes', '');
        for (const note of notes) {
          lines.push(
            `#### ${note.title} — *by \`${note.authorAgent}\` (${note.createdAt.slice(0, 16).replace('T', ' ')})*`,
            note.summary ? `**Summary**: ${note.summary}` : '',
            note.body && note.body !== note.summary ? `\n${note.body}` : ''
          );
          if (note.nextSteps.length > 0) {
            lines.push('**Next Steps**:');
            for (const step of note.nextSteps) {
              lines.push(`- ${step}`);
            }
          }
          lines.push('');
        }
      }
    }
  } else {
    const projects = vault.listProjects();
    if (projects.length > 0) {
      lines.push('---', '## Projects Overview', '');
      for (const proj of projects) {
        lines.push(
          `- **${proj.name}** (\`${proj.slug}\`) — status: \`${proj.status}\`, tasks: ${proj.taskCount}, notes: ${proj.noteCount}`
        );
      }
      lines.push('');
    }
  }

  if (options.includeSkills) {
    const skills = vault.listSkills();
    if (skills.length > 0) {
      lines.push('---', '## Available Skills', '');
      for (const skill of skills) {
        lines.push(`- **${skill.name}**: ${skill.description || 'No description'}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}
