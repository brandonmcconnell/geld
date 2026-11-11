import type { PathMatcher } from "@geld/core/matcher";
import type { SignalFile } from "./pull-signals";

export type GuideFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type GuideStep = {
  id: string;
  title: string;
  note: string;
  /** Files Geld's categories set aside: worth a skim, not a read. */
  skim: boolean;
  files: GuideFile[];
};

const CONTRACT =
  /(^|\/)(types?|schema|schemas|models?|interfaces?|contracts?|api|routes?|migrations?)(\/|\.[^/]+$)|\.d\.ts$|\.(proto|graphql|gql|sql)$/i;
const DOCS = /\.(md|mdx|rst|txt|adoc)$/i;

function byWeight(a: GuideFile, b: GuideFile): number {
  return (
    b.additions + b.deletions - (a.additions + a.deletions) ||
    a.path.localeCompare(b.path)
  );
}

/**
 * The order to read a pull request in: what the change promises, then the
 * change itself, largest first, then its words, then what Geld sets aside.
 */
export function reviewGuide(
  files: readonly SignalFile[],
  matcher: PathMatcher
): GuideStep[] {
  const contracts: GuideFile[] = [];
  const changes: GuideFile[] = [];
  const docs: GuideFile[] = [];
  const aside = new Map<string, GuideStep>();
  for (const file of files) {
    const entry = {
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
    };
    const category = matcher.categorize(file.filename);
    if (category !== null) {
      const step = aside.get(category.id) ?? {
        id: `aside:${category.id}`,
        title: category.title,
        note: "Set aside by your categories. Skim.",
        skim: true,
        files: [],
      };
      step.files.push(entry);
      aside.set(category.id, step);
    } else if (DOCS.test(file.filename)) {
      docs.push(entry);
    } else if (CONTRACT.test(file.filename)) {
      contracts.push(entry);
    } else {
      changes.push(entry);
    }
  }
  const order: string[] = matcher.activeCategories.map(
    (category) => category.id
  );
  const steps: GuideStep[] = [
    {
      id: "contracts",
      title: "Shapes and contracts",
      note: "Types, schemas and routes. What the change promises.",
      skim: false,
      files: contracts.sort(byWeight),
    },
    {
      id: "changes",
      title: "The change",
      note: "Largest first.",
      skim: false,
      files: changes.sort(byWeight),
    },
    {
      id: "docs",
      title: "Docs",
      note: "Do the words match the code?",
      skim: false,
      files: docs.sort(byWeight),
    },
    ...[...aside.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([, step]) => ({ ...step, files: step.files.sort(byWeight) })),
  ];
  return steps.filter((step) => step.files.length > 0);
}

/** The first file in guide order the reader has not ticked as viewed. */
export function nextInGuide(
  steps: readonly GuideStep[],
  isViewed: (path: string) => boolean
): string | null {
  for (const step of steps) {
    for (const file of step.files) {
      if (!isViewed(file.path)) return file.path;
    }
  }
  return null;
}
