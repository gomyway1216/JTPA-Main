#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["ja", "en"];
const DEFAULT_LOCALE = "ja";
const MESSAGE_DIR = "messages";

function readMessages(locale) {
  const file = join(MESSAGE_DIR, `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function flatten(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, nested]) =>
      flatten(nested, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

function valueKind(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function getByPath(messages, path) {
  return path.split(".").reduce((cur, part) => cur?.[part], messages);
}

function splitTopLevelCommas(value, limit = Number.POSITIVE_INFINITY) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0 && parts.length < limit - 1) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function collectNestedOptionArguments(content, args) {
  let depth = 0;
  let start = -1;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === "{") {
      if (depth === 0) start = i + 1;
      depth += 1;
      continue;
    }

    if (ch !== "}") continue;

    depth -= 1;
    if (depth === 0 && start >= 0) {
      collectBraceArguments(content.slice(start, i), args);
      start = -1;
    }
  }
}

function collectBraceArguments(message, args) {
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] !== "{") continue;

    let depth = 1;
    let content = "";
    for (let j = i + 1; j < message.length; j += 1) {
      const ch = message[j];
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      if (depth === 0) {
        const [rawName, rawType] = splitTopLevelCommas(content, 3);
        const name = rawName?.trim();
        const type = rawType?.trim();

        if (name && !name.startsWith("#")) args.add(name);
        if (type === "plural" || type === "select") {
          collectNestedOptionArguments(content, args);
        }

        i = j;
        break;
      }
      content += ch;
    }
  }
}

function braceArguments(message) {
  const args = new Set();
  collectBraceArguments(message, args);
  return [...args].sort();
}

function richTags(message) {
  return [...message.matchAll(/<\/?[A-Za-z][A-Za-z0-9_.-]*\s*\/?>/g)]
    .map((match) => match[0].replace(/\s+\/>$/, "/>"))
    .sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [locale, readMessages(locale)]),
);
const baselineEntries = flatten(catalogs[DEFAULT_LOCALE]);
const baselinePaths = new Set(baselineEntries.map(([path]) => path));
const errors = [];
let stringCount = 0;

for (const locale of LOCALES) {
  const entries = flatten(catalogs[locale]);
  const paths = new Set(entries.map(([path]) => path));

  for (const [path, value] of entries) {
    const baselineValue = getByPath(catalogs[DEFAULT_LOCALE], path);
    if (!baselinePaths.has(path)) {
      errors.push(`${locale}: extra key "${path}"`);
      continue;
    }
    if (valueKind(value) !== valueKind(baselineValue)) {
      errors.push(
        `${locale}: key "${path}" is ${valueKind(value)}, expected ${valueKind(
          baselineValue,
        )}`,
      );
    }
  }

  for (const path of baselinePaths) {
    if (!paths.has(path)) errors.push(`${locale}: missing key "${path}"`);
  }
}

for (const [path, baselineValue] of baselineEntries) {
  if (typeof baselineValue !== "string") continue;
  stringCount += 1;
  const expectedArgs = braceArguments(baselineValue);
  const expectedTags = richTags(baselineValue);

  for (const locale of LOCALES.filter((item) => item !== DEFAULT_LOCALE)) {
    const value = getByPath(catalogs[locale], path);
    if (typeof value !== "string") continue;

    const args = braceArguments(value);
    if (!sameSet(args, expectedArgs)) {
      errors.push(
        `${locale}: key "${path}" ICU args ${JSON.stringify(
          args,
        )}, expected ${JSON.stringify(expectedArgs)}`,
      );
    }

    const tags = richTags(value);
    if (!sameSet(tags, expectedTags)) {
      errors.push(
        `${locale}: key "${path}" rich tags ${JSON.stringify(
          tags,
        )}, expected ${JSON.stringify(expectedTags)}`,
      );
    }
  }
}

if (errors.length) {
  console.error(`i18n catalog check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `i18n catalog check passed: ${LOCALES.join(", ")} / ${stringCount} strings`,
);
