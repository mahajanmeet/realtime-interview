// Presentation only: never guess replacement words from an ASR hypothesis.
// Keep the unmodified hypothesis in rawText for review and accuracy evaluation.
const technicalNames = [
  'API',
  'APIs',
  'SDK',
  'SQL',
  'NoSQL',
  'JWT',
  'OAuth',
  'gRPC',
  'REST',
  'GraphQL',
  'HTTP',
  'HTTPS',
  'TCP',
  'UDP',
  'DNS',
  'TLS',
  'SSH',
  'JSON',
  'XML',
  'HTML',
  'CSS',
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C++',
  'C#',
  '.NET',
  'Node.js',
  'React',
  'Angular',
  'Vue',
  'Next.js',
  'Spring Boot',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Docker',
  'Kubernetes',
  'kubectl',
  'Nginx',
  'Kafka',
  'AWS',
  'Azure',
  'GCP',
  'EC2',
  'S3',
  'GitHub',
  'GitLab',
  'CI/CD',
  'DevOps',
  'AI',
  'ML',
  'NLP',
  'LLM',
  'LLMs',
  'RNN',
  'RNNs',
  'CNN',
  'CNNs',
  'LSTM',
  'GPU',
  'GPUs',
  'CPU',
  'CPUs',
  'TensorFlow',
  'PyTorch',
  'NumPy',
  'scikit-learn',
  'BERT',
  'GPT',
  'OpenAI',
  'WebRTC',
  'ONNX',
  'English',
];

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = new Map(technicalNames.map((name) => [name.toLowerCase(), name]));
const namePattern = new RegExp(
  `(^|[^\\w])(${technicalNames
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join('|')})(?=$|[^\\w])`,
  'gi',
);

export const formatTranscript = (input: string, final: boolean): string => {
  let text = input.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Sherpa's English model emits capitals. Do not lowercase mixed-case output
  // from other engines, which may already contain proper nouns or code.
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase()) text = text.toLowerCase();
  text = text.replace(
    namePattern,
    (_match, prefix: string, name: string) => prefix + names.get(name.toLowerCase()),
  );
  text = text.replace(/\bi\b/g, 'I');
  // Capitalize starts, preserving internal periods in versions and identifiers.
  text = text.replace(
    /(^|[.!?]\s+)(["'([]*)([a-z])/g,
    (_match, prefix: string, quote: string, letter: string) =>
      prefix + quote + letter.toUpperCase(),
  );
  // A pause finalizes an utterance. Avoid fabricated comma/question boundaries
  // within continuous speech; richer restoration requires a punctuation model.
  if (final && !/[.!?:;]["')\]]*$/.test(text)) text += '.';
  return text;
};
