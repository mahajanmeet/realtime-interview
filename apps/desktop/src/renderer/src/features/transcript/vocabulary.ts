export type VocabularyEntry = {
  canonical: string;
  aliases: string[];
  context: string[];
  weight: number;
};

export type VocabularyProfile = {
  id: string;
  entries: VocabularyEntry[];
};

export const generalTechnicalVocabulary: VocabularyProfile = {
  id: 'general-technical',
  entries: [
    {
      canonical: 'API',
      aliases: ['a p i', 'ay pee eye'],
      context: ['endpoint', 'request', 'response', 'REST', 'GraphQL'],
      weight: 1,
    },
    {
      canonical: 'JWT',
      aliases: ['j w t', 'jay double you tee'],
      context: ['token', 'authentication', 'authorization', 'OAuth'],
      weight: 1,
    },
    {
      canonical: 'gRPC',
      aliases: ['g r p c', 'gee r p c'],
      context: ['protobuf', 'service', 'remote procedure', 'API'],
      weight: 1,
    },
  ],
};

export const backendVocabulary: VocabularyProfile = {
  id: 'backend',
  entries: [
    {
      canonical: 'SQL',
      aliases: ['sequel', 's q l', 'ess cue ell'],
      context: ['database', 'query', 'table', 'schema', 'join', 'PostgreSQL', 'MySQL'],
      weight: 1,
    },
    {
      canonical: 'PostgreSQL',
      aliases: ['postgre sequel', 'post grass sequel', 'postgres sql'],
      context: ['database', 'SQL', 'query', 'postgres'],
      weight: 1,
    },
    {
      canonical: 'Kubernetes',
      aliases: ['cooper netties', 'kuberneties'],
      context: ['pod', 'cluster', 'deployment', 'container', 'Docker'],
      weight: 1,
    },
    {
      canonical: 'kubectl',
      aliases: ['cube control', 'kube control'],
      context: ['pod', 'deployment', 'namespace', 'cluster'],
      weight: 1,
    },
    {
      canonical: 'Nginx',
      aliases: ['engine x'],
      context: ['proxy', 'server', 'load balancer', 'HTTP'],
      weight: 1,
    },
    {
      canonical: 'Redis',
      aliases: ['red is'],
      context: ['cache', 'key value', 'database', 'queue'],
      weight: 1,
    },
  ],
};

export const awsVocabulary: VocabularyProfile = {
  id: 'aws',
  entries: [
    {
      canonical: 'AWS',
      aliases: ['a w s'],
      context: ['cloud', 'EC2', 'S3', 'Lambda'],
      weight: 1,
    },
    {
      canonical: 'EC2',
      aliases: ['e c two', 'easy two'],
      context: ['instance', 'AWS', 'compute', 'server'],
      weight: 1,
    },
    {
      canonical: 'S3',
      aliases: ['s three'],
      context: ['bucket', 'object', 'storage', 'AWS'],
      weight: 1,
    },
  ],
};

export const composeVocabularyProfiles = (
  id: string,
  profiles: VocabularyProfile[],
): VocabularyProfile => {
  const entries = new Map<string, VocabularyEntry>();

  for (const profile of profiles) {
    for (const entry of profile.entries) {
      const existing = entries.get(entry.canonical.toLowerCase());

      if (!existing) {
        entries.set(entry.canonical.toLowerCase(), {
          ...entry,
          aliases: [...entry.aliases],
          context: [...entry.context],
        });
        continue;
      }

      existing.aliases = [...new Set([...existing.aliases, ...entry.aliases])];
      existing.context = [...new Set([...existing.context, ...entry.context])];
      existing.weight = Math.max(existing.weight, entry.weight);
    }
  }

  return { id, entries: [...entries.values()] };
};

export const interviewVocabulary = composeVocabularyProfiles('backend-aws', [
  generalTechnicalVocabulary,
  backendVocabulary,
  awsVocabulary,
]);

export const getHotwords = (profile: VocabularyProfile): string[] =>
  [...new Set(profile.entries.map((entry) => entry.canonical.toUpperCase()))].sort();
