// Builds stats cards (SVG) for the profile README from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... node stats.mjs <username> <outDir>
import { mkdirSync, writeFileSync } from "node:fs";

const [user, outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !token) throw new Error("usage: GITHUB_TOKEN=... node stats.mjs <user> [outDir]");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const base = await gql(
  `query($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
        totalCount
        nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
      }
    }
  }`,
  { login: user },
);

// Contribution calendar for every year since the account was created.
const days = [];
let totals = { commits: 0, prs: 0, issues: 0, reviews: 0, private: 0 };
const created = new Date(base.user.createdAt);
const now = new Date();
for (let year = created.getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
  const from = new Date(Math.max(Date.UTC(year, 0, 1), created.getTime()));
  const to = new Date(Math.min(Date.UTC(year, 11, 31, 23, 59, 59), now.getTime()));
  const d = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions totalPullRequestContributions totalIssueContributions
          totalPullRequestReviewContributions restrictedContributionsCount
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: user, from: from.toISOString(), to: to.toISOString() },
  );
  const c = d.user.contributionsCollection;
  totals.commits += c.totalCommitContributions;
  totals.prs += c.totalPullRequestContributions;
  totals.issues += c.totalIssueContributions;
  totals.reviews += c.totalPullRequestReviewContributions;
  totals.private += c.restrictedContributionsCount;
  for (const w of c.contributionCalendar.weeks) days.push(...w.contributionDays);
}
days.sort((a, b) => a.date.localeCompare(b.date));

const total = days.reduce((s, d) => s + d.contributionCount, 0);
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
let i = days.length - 1;
if (i >= 0 && days[i].contributionCount === 0) i--; // today may not have activity yet
for (; i >= 0 && days[i].contributionCount > 0; i--) current++;

const repos = base.user.repositories;
const stars = repos.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const langs = {};
for (const r of repos.nodes) for (const e of r.languages.edges) {
  langs[e.node.name] ??= { size: 0, color: e.node.color || "#8b949e" };
  langs[e.node.name].size += e.size;
}
const topLangs = Object.entries(langs).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const langTotal = topLangs.reduce((s, [, l]) => s + l.size, 0) || 1;

const themes = {
  dark: { bg: "#1a1b27", title: "#70a5fd", text: "#a9b1d6", value: "#ffffff", accent: "#bf91f3", track: "#2a2e42" },
  light: { bg: "#ffffff", title: "#0969da", text: "#57606a", value: "#1f2328", accent: "#8250df", track: "#eaeef2" },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif"`;

function statsCard(t) {
  const rows = [
    ["Total contributions", total],
    ["Commits", totals.commits],
    ["Pull requests", totals.prs],
    ["Issues", totals.issues],
    ["Repositories", repos.totalCount],
    ["Stars earned", stars],
  ];
  const body = rows.map(([k, v], n) => `
    <text x="25" y="${70 + n * 26}" fill="${t.text}" font-size="14" ${font}>${esc(k)}</text>
    <text x="300" y="${70 + n * 26}" fill="${t.value}" font-size="14" font-weight="600" text-anchor="end" ${font}>${v.toLocaleString("en-US")}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="325" height="230" viewBox="0 0 325 230">
  <rect width="325" height="230" rx="10" fill="${t.bg}"/>
  <text x="25" y="36" fill="${t.title}" font-size="17" font-weight="600" ${font}>GitHub Stats</text>${body}
</svg>`;
}

function streakCard(t) {
  const col = (x, value, label) => `
    <text x="${x}" y="102" fill="${t.value}" font-size="30" font-weight="700" text-anchor="middle" ${font}>${value.toLocaleString("en-US")}</text>
    <text x="${x}" y="165" fill="${t.text}" font-size="13" text-anchor="middle" ${font}>${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="325" height="230" viewBox="0 0 325 230">
  <rect width="325" height="230" rx="10" fill="${t.bg}"/>
  <text x="25" y="36" fill="${t.title}" font-size="17" font-weight="600" ${font}>Contribution Streak</text>
  <circle cx="162" cy="92" r="40" fill="none" stroke="${t.accent}" stroke-width="4"/>
  ${col(162, current, "Current streak")}
  ${col(60, longest, "Longest")}
  ${col(265, total, "Total")}
  <text x="162" y="200" fill="${t.text}" font-size="11" text-anchor="middle" ${font}>Updated ${now.toISOString().slice(0, 10)}</text>
</svg>`;
}

function langsCard(t) {
  let x = 25;
  const bar = topLangs.map(([, l]) => {
    const w = (l.size / langTotal) * 600;
    const r = `<rect x="${x.toFixed(1)}" y="55" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
    x += w;
    return r;
  }).join("");
  const legend = topLangs.map(([name, l], n) => {
    const lx = 25 + (n % 3) * 205, ly = 95 + Math.floor(n / 3) * 26;
    return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
    <text x="${lx + 16}" y="${ly}" fill="${t.text}" font-size="13" ${font}>${esc(name)} ${((l.size / langTotal) * 100).toFixed(1)}%</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="650" height="150" viewBox="0 0 650 150">
  <rect width="650" height="150" rx="10" fill="${t.bg}"/>
  <text x="25" y="36" fill="${t.title}" font-size="17" font-weight="600" ${font}>Most Used Languages</text>
  <clipPath id="c"><rect x="25" y="55" width="600" height="10" rx="5"/></clipPath>
  <rect x="25" y="55" width="600" height="10" rx="5" fill="${t.track}"/>
  <g clip-path="url(#c)">${bar}</g>${legend}
</svg>`;
}

mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(themes)) {
  writeFileSync(`${outDir}/stats-${name}.svg`, statsCard(t));
  writeFileSync(`${outDir}/streak-${name}.svg`, streakCard(t));
  if (topLangs.length) writeFileSync(`${outDir}/langs-${name}.svg`, langsCard(t));
}
console.log({ total, ...totals, current, longest, repos: repos.totalCount, stars, langs: topLangs.map(([n]) => n) });
