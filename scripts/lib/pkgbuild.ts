import { file, write } from "bun";

import {
  currentVersionSchema,
  type CurrentVersion,
  type LatestVersion,
} from "../schemas";

function getScalarValue(lines: string[], key: string) {
  return lines
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();
}

function stripInlineComment(line: string) {
  const walk = (
    index: number,
    quote: '"' | "'" | null,
    acc: string,
  ): string => {
    if (index >= line.length) return acc;
    const char = line[index] ?? "";
    if ((char === "'" || char === '"') && quote === null)
      return walk(index + 1, char, `${acc}${char}`);
    if (char === quote) return walk(index + 1, null, `${acc}${char}`);
    if (char === "#" && quote === null) return acc;
    return walk(index + 1, quote, `${acc}${char}`);
  };
  return walk(0, null, "").trim();
}

function parseShellWords(input: string) {
  interface ParseState {
    words: string[];
    current: string;
    quote: '"' | "'" | null;
  }

  const reduced = [...input].reduce<ParseState>(
    (state, char) => {
      if ((char === "'" || char === '"') && state.quote === null)
        return { ...state, quote: char as '"' | "'" };
      if (char === state.quote) return { ...state, quote: null };
      if (
        (char === " " || char === "\t" || char === "\n" || char === "\r") &&
        state.quote === null
      ) {
        if (state.current.length === 0) return state;
        return {
          words: [...state.words, state.current],
          current: "",
          quote: state.quote,
        };
      }
      return { ...state, current: `${state.current}${char}` };
    },
    {
      words: [] as string[],
      current: "",
      quote: null as '"' | "'" | null,
    },
  );

  return reduced.current.length > 0
    ? [...reduced.words, reduced.current]
    : reduced.words;
}

function parseArrayField(lines: string[], fieldName: string) {
  const startIndex = lines.findIndex((line) =>
    line.trim().startsWith(`${fieldName}=`),
  );
  if (startIndex === -1) return [] as string[];

  const opening = lines[startIndex]?.trim().slice(fieldName.length + 1).trim() ?? "";
  if (!opening.startsWith("(")) return [] as string[];
  const withoutOpen = opening.slice(1);

  const firstItem = withoutOpen.includes(")")
    ? withoutOpen.slice(0, withoutOpen.indexOf(")"))
    : withoutOpen;
  const trailingItems = withoutOpen.includes(")")
    ? []
    : lines
        .slice(startIndex + 1)
        .reduce(
          (state, line) => {
            if (state.done) return state;
            if (!line.includes(")"))
              return { done: false, chunks: [...state.chunks, line] };
            return {
              done: true,
              chunks: [...state.chunks, line.slice(0, line.indexOf(")"))],
            };
          },
          { done: false, chunks: [] as string[] },
        ).chunks;
  const rawItems = [firstItem, ...trailingItems];

  return rawItems.reduce((parsed, rawLine) => {
    const noComment = stripInlineComment(rawLine);
    if (!noComment) return parsed;
    return [...parsed, ...parseShellWords(noComment)];
  }, [] as string[]);
}

function parseIndexedAssignment(line: string, fieldName: string) {
  const trimmed = line.trim();
  const prefix = `${fieldName}[`;
  if (!trimmed.startsWith(prefix)) return null;

  const closeBracketIndex = trimmed.indexOf("]", prefix.length);
  if (closeBracketIndex < 0 || trimmed[closeBracketIndex + 1] !== "=") return null;

  const indexText = trimmed.slice(prefix.length, closeBracketIndex);
  if (
    indexText.length === 0 ||
    ![...indexText].every((char) => char >= "0" && char <= "9")
  ) {
    return null;
  }

  return {
    index: Number.parseInt(indexText, 10),
    rawValue: trimmed.slice(closeBracketIndex + 2),
  };
}

function parseIndexedFieldOverrides(
  lines: string[],
  fieldName: string,
  variables: Record<string, string>,
) {
  return lines.reduce((overrides, line) => {
    const assignment = parseIndexedAssignment(line, fieldName);
    if (!assignment) return overrides;

    // Indexed overrides run stripInlineComment -> trimOuterQuotes -> expandVariables,
    // so unlike parseShellWords single quotes do not suppress expansion here.
    return overrides.set(
      assignment.index,
      expandVariables(
        trimOuterQuotes(stripInlineComment(assignment.rawValue)),
        variables,
      ),
    );
  }, new Map<number, string>());
}

function expandVariables(input: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (value, [key, replacement]) =>
      value.split(`\${${key}}`).join(replacement).split(`$${key}`).join(replacement),
    input,
  );
}

function trimOuterQuotes(input: string) {
  if (input.length < 2) return input;
  if (input.startsWith("'") && input.endsWith("'")) return input.slice(1, -1);
  if (input.startsWith('"') && input.endsWith('"')) return input.slice(1, -1);
  return input;
}

function getPkgbuildVariables(lines: string[]) {
  const pkgver = getScalarValue(lines, "pkgver") ?? "";
  const upstreamPkgver = getScalarValue(lines, "_upstream_pkgver") ?? pkgver;
  const commit = stripInlineComment(getScalarValue(lines, "_commit") ?? "");

  return {
    pkgver,
    _upstream_pkgver: upstreamPkgver,
    _commit: commit,
  };
}

function getExpandedArrayField(
  lines: string[],
  fieldName: string,
  variables: Record<string, string>,
) {
  return parseArrayField(lines, fieldName).map((item) =>
    expandVariables(item, variables),
  );
}

function getExpandedArrayFieldWithOverrides(
  lines: string[],
  fieldName: string,
  variables: Record<string, string>,
) {
  const values = [...getExpandedArrayField(lines, fieldName, variables)];

  for (const [index, value] of parseIndexedFieldOverrides(
    lines,
    fieldName,
    variables,
  )) {
    if (index >= values.length) {
      throw new Error(
        `Invalid ${fieldName}[${index}] override: array has ${values.length} entries`,
      );
    }

    values[index] = value;
  }

  return values;
}

export async function parseCurrentVersion(
  pkgbuildPath: string,
): Promise<CurrentVersion> {
  const text = await file(pkgbuildPath).text();
  const lines = text.split("\n");

  const pkgver = getScalarValue(lines, "pkgver");
  const upstream = getScalarValue(lines, "_upstream_pkgver");
  const commitRaw = getScalarValue(lines, "_commit");
  if (!pkgver || !commitRaw)
    throw new Error("Could not parse pkgver/_commit from PKGBUILD");

  return currentVersionSchema.parse({
    pkgver,
    upstreamPkgver: upstream ?? pkgver,
    commit: stripInlineComment(commitRaw),
  });
}

export async function parseSourceEntries(pkgbuildPath: string) {
  const lines = (await file(pkgbuildPath).text()).split("\n");
  return getExpandedArrayFieldWithOverrides(
    lines,
    "source",
    getPkgbuildVariables(lines),
  );
}

export async function parseSha512Sums(pkgbuildPath: string) {
  const lines = (await file(pkgbuildPath).text()).split("\n");
  return getExpandedArrayFieldWithOverrides(
    lines,
    "sha512sums",
    getPkgbuildVariables(lines),
  );
}

export async function updatePkgbuild(
  pkgbuildPath: string,
  latest: LatestVersion,
  newSha512: string,
) {
  const lines = (await file(pkgbuildPath).text()).split("\n");
  const reduced = lines.reduce(
    (state, line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("pkgver="))
        return {
          ...state,
          lines: [...state.lines, `pkgver=${latest.pkgver}`],
          sawPkgver: true,
        };
      if (trimmed.startsWith("pkgrel="))
        return {
          ...state,
          lines: [...state.lines, "pkgrel=1"],
        };
      if (trimmed.startsWith("_upstream_pkgver="))
        return {
          ...state,
          lines: [...state.lines, `_upstream_pkgver=${latest.upstreamPkgver}`],
          sawUpstreamPkgver: true,
        };
      if (trimmed.startsWith("_commit="))
        return {
          ...state,
          lines: [...state.lines, `_commit=${latest.commit}`],
          sawCommit: true,
        };
      if (trimmed.startsWith("sha512sums[0]="))
        return {
          ...state,
          lines: [...state.lines, `sha512sums[0]=${newSha512}`],
          sawSha: true,
        };
      return {
        ...state,
        lines: [...state.lines, line],
      };
    },
    {
      lines: [] as string[],
      sawPkgver: false,
      sawUpstreamPkgver: false,
      sawCommit: false,
      sawSha: false,
    },
  );

  if (!reduced.sawPkgver || !reduced.sawCommit || !reduced.sawSha)
    throw new Error("Missing one of pkgver/_commit/sha512sums[0] in PKGBUILD");

  const finalLines = !reduced.sawUpstreamPkgver
    ? (() => {
        const pkgverLine = reduced.lines.findIndex((line) =>
          line.trim().startsWith("pkgver="),
        );
        if (pkgverLine < 0) return reduced.lines;
        return [
          ...reduced.lines.slice(0, pkgverLine + 1),
          `_upstream_pkgver=${latest.upstreamPkgver}`,
          ...reduced.lines.slice(pkgverLine + 1),
        ];
      })()
    : reduced.lines;

  await write(pkgbuildPath, `${finalLines.join("\n")}\n`);
}

export async function generateSrcinfo(pkgbuildPath: string) {
  const text = await file(pkgbuildPath).text();
  const lines = text.split("\n");

  const vars = getPkgbuildVariables(lines);
  const pkgver = vars.pkgver;

  const pkgname = getScalarValue(lines, "pkgname") ?? "";
  const pkgrel = getScalarValue(lines, "pkgrel") ?? "";
  const pkgdesc = trimOuterQuotes(getScalarValue(lines, "pkgdesc") ?? "");
  const url = trimOuterQuotes(getScalarValue(lines, "url") ?? "");

  const expandArray = (field: string) =>
    getExpandedArrayField(lines, field, vars);

  const fields: Record<string, string[]> = {
    arch: expandArray("arch"),
    license: expandArray("license"),
    makedepends: expandArray("makedepends"),
    depends: expandArray("depends"),
    optdepends: expandArray("optdepends"),
    provides: expandArray("provides"),
    conflicts: expandArray("conflicts"),
    noextract: expandArray("noextract"),
    options: expandArray("options"),
    source: expandArray("source"),
    sha512sums: getExpandedArrayFieldWithOverrides(lines, "sha512sums", vars),
  };

  const out = [
    `pkgbase = ${pkgname}`,
    `\tpkgdesc = ${pkgdesc}`,
    `\tpkgver = ${pkgver}`,
    `\tpkgrel = ${pkgrel}`,
    `\turl = ${url}`,
    ...Object.entries(fields).flatMap(([field, values]) =>
      values.map((value) => `\t${field} = ${value}`),
    ),
    "",
    `pkgname = ${pkgname}`,
  ];

  return `${out.join("\n")}\n`;
}
