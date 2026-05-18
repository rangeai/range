import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Range",
  tagline: "Agentic IDE for engineers training robot policies in simulation",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  // GitHub Pages: <org>.github.io/<repo>
  url: "https://rangeai.github.io",
  baseUrl: "/range/",
  organizationName: "rangeai",
  projectName: "range",
  deploymentBranch: "gh-pages",
  trailingSlash: false,

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Range's display + body fonts (Bricolage Grotesque + Geist + JetBrains Mono)
  stylesheets: [
    {
      href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Geist:wght@100..900&family=JetBrains+Mono:wght@300..700&display=swap",
      rel: "stylesheet",
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          // The single source of truth lives one level up; the site reads
          // from there so GitHub renders the same files inline AND the doc
          // site renders them themed. No copy/sync needed.
          path: "../docs",
          routeBasePath: "/docs",
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/rangeai/range/edit/main/docs/",
          // Pieces of the docs/ tree that aren't part of the public
          // documentation site.
          exclude: [
            "archive/**",
            "mocks/**",
            "media/**",
            "posts/**", // blog plugin reads these instead
          ],
        },
        blog: {
          // Lives in site/blog/ (default Docusaurus location).
          // We tried ../docs/posts/ but the blog plugin's metadata
          // extraction is buggy on out-of-tree paths in 3.10.
          routeBasePath: "/blog",
          blogTitle: "Range — Fixtures & Engineering Notes",
          blogDescription:
            "Per-fixture writeups + engineering notes from the Range team.",
          showReadingTime: true,
          feedOptions: { type: ["rss", "atom"], xslt: true },
          editUrl: "https://github.com/rangeai/range/edit/main/site/blog/",
          onInlineTags: "ignore",
          onInlineAuthors: "ignore",
          onUntruncatedBlogPosts: "ignore",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/og-card.png",
    colorMode: {
      defaultMode: "dark",
      // Keep the toggle (accessibility), just default everyone to dark.
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: "range",
      logo: {
        alt: "Range",
        src: "img/range-mark.svg",
        srcDark: "img/range-mark.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "userSidebar",
          position: "left",
          label: "Docs",
        },
        { to: "/blog", label: "Blog", position: "left" },
        {
          type: "docSidebar",
          sidebarId: "contributingSidebar",
          position: "left",
          label: "Contributing",
        },
        {
          href: "https://github.com/rangeai/range",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "User guide", to: "/docs/user_guide" },
            { label: "Setup", to: "/docs/dev_setup" },
            { label: "Robotics ELI5", to: "/docs/eli5" },
          ],
        },
        {
          title: "Proof",
          items: [
            { label: "Playground fixtures", to: "/docs/playground_fixtures" },
            { label: "Blog", to: "/blog" },
          ],
        },
        {
          title: "Hack",
          items: [
            { label: "Architecture", to: "/docs/contributing/architecture" },
            {
              label: "Repo",
              href: "https://github.com/rangeai/range",
            },
            {
              label: "Issues",
              href: "https://github.com/rangeai/range/issues",
            },
          ],
        },
      ],
      copyright: `MIT-licensed · Range ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["bash", "diff", "yaml", "python", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
