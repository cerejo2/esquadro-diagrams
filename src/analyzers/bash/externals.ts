// External commands: anything a script runs that is neither a project function
// nor a shell builtin. Grouped by what they are for, so the layout can keep
// each family together (PROMPT.md §5.1: externals apart and in grey).

// prettier-ignore
const GROUPS: Record<string, string[]> = {
  files: [
    'basename', 'cat', 'chgrp', 'chmod', 'chown', 'cp', 'dd', 'df', 'dirname', 'du', 'file', 'find', 'install',
    'ln', 'ls', 'mkdir', 'mktemp', 'mv', 'readlink', 'realpath', 'rm', 'rmdir', 'stat', 'touch', 'tree',
  ],
  text: [
    'awk', 'column', 'comm', 'cut', 'diff', 'fmt', 'fold', 'gawk', 'grep', 'egrep', 'fgrep', 'head', 'iconv',
    'jq', 'join', 'less', 'more', 'nl', 'paste', 'rev', 'sed', 'sort', 'split', 'tac', 'tail', 'tee', 'tr',
    'uniq', 'wc', 'xargs', 'yq',
  ],
  archive: ['bzip2', 'gunzip', 'gzip', 'tar', 'unzip', 'xz', 'zip', 'zstd'],
  hashing: ['b2sum', 'base64', 'cksum', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'openssl'],
  system: [
    'date', 'env', 'groups', 'hostname', 'id', 'kill', 'killall', 'logger', 'nohup', 'nproc', 'pgrep', 'pkill',
    'ps', 'sleep', 'sudo', 'su', 'systemctl', 'timeout', 'uname', 'uptime', 'who', 'whoami',
  ],
  network: ['curl', 'nc', 'ping', 'rsync', 'scp', 'ssh', 'wget'],
  dev: ['docker', 'gcc', 'git', 'make', 'node', 'npm', 'pip', 'python', 'python3'],
};

const GROUP_OF = new Map<string, string>(
  Object.entries(GROUPS).flatMap(([group, names]) => names.map((n) => [n, group] as const)),
);

/** The family an external command belongs to (`files`, `text`...), or `other`. */
export function externalGroup(name: string): string {
  return GROUP_OF.get(name) ?? 'other';
}
