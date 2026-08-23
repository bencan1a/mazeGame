/**
 * Flags comments that point at something outside the file they sit in.
 *
 * A comment cannot be kept in step with a document, an issue, or a stream
 * label it merely cites, so a citation is the part most likely to outlive what
 * it describes. Reference material belongs in docs/; the comment keeps only
 * what a reader can check against the lines beside it.
 */

const PATTERNS = [
  { re: /\bPRD\b/, what: 'a PRD reference' },
  { re: /\bADR-\d+/i, what: 'an ADR number' },
  { re: /\bdocs\//, what: 'a path into docs/' },
  {
    re: /\b(?:CONTRACTS|METRICS|WORKFLOW|TESTING|PLAN|ARCHITECTURE)\.md\b/,
    what: 'a doc filename',
  },
  { re: /(?:^|[\s(])#\d+\b/, what: 'an issue number' },
  { re: /\bAC #?\d+\b/, what: 'an acceptance-criterion number' },
  { re: /(?:^|[\s(])\bS[1-7]\b(?![\w-])/, what: 'a stream label' },
  { re: /(?:^|[\s(])\bR[1-3]\b(?![\w-])/, what: 'a risk label' },
];

/** @type {import('eslint').Rule.RuleModule} */
export const noCommentCrossReferences = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow comments that cite docs, issues, streams, or risks by number',
    },
    schema: [],
    messages: {
      crossReference:
        'This comment cites {{what}}, which nothing keeps in step with it. State what a reader can check here, or move it to docs/.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Program() {
        for (const comment of source.getAllComments()) {
          for (const { re, what } of PATTERNS) {
            if (re.test(comment.value)) {
              context.report({ loc: comment.loc, messageId: 'crossReference', data: { what } });
              break;
            }
          }
        }
      },
    };
  },
};

export default { rules: { 'no-comment-cross-references': noCommentCrossReferences } };
