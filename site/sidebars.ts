import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  // The public "I want to use Range" sidebar.
  userSidebar: [
    {
      type: "category",
      label: "Getting started",
      collapsed: false,
      items: ["dev_setup", "user_guide"],
    },
    {
      type: "category",
      label: "Proof harness",
      collapsed: false,
      items: ["playground_fixtures"],
    },
    {
      type: "category",
      label: "Background reading",
      collapsed: true,
      items: ["eli5", "eli5_foundations"],
    },
  ],

  // The separate "I want to contribute to Range" sidebar.
  contributingSidebar: [
    {
      type: "doc",
      id: "contributing/README",
      label: "Overview",
    },
    {
      type: "doc",
      id: "contributing/architecture",
      label: "Architecture",
    },
    {
      type: "doc",
      id: "contributing/product_spec",
      label: "Product spec",
    },
    {
      type: "doc",
      id: "contributing/positioning",
      label: "Positioning rules",
    },
    {
      type: "category",
      label: "Direction notes",
      collapsed: true,
      items: [
        "contributing/direction/2026_05_14",
        "contributing/direction/2026_05_15",
      ],
    },
  ],
};

export default sidebars;
