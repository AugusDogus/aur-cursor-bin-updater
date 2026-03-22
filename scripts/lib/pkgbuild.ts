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

  const pkgver = getScalarValue(lines, "pkgver") ?? "";
  const upstreamPkgver = getScalarValue(lines, "_upstream_pkgver") ?? pkgver;
  const commit = stripInlineComment(getScalarValue(lines, "_commit") ?? "");
  const vars = { pkgver, _upstream_pkgver: upstreamPkgver, _commit: commit };

  const pkgname = getScalarValue(lines, "pkgname") ?? "";
  const pkgrel = getScalarValue(lines, "pkgrel") ?? "";
  const pkgdesc = trimOuterQuotes(getScalarValue(lines, "pkgdesc") ?? "");
  const url = trimOuterQuotes(getScalarValue(lines, "url") ?? "");

  const expandArray = (field: string) =>
    parseArrayField(lines, field).map((item) => expandVariables(item, vars));

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
    sha512sums: expandArray("sha512sums"),
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
