import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

function HeroBanner(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.eyebrow}>v0.6 · open to contributors</div>
        <Heading as="h1" className={styles.title}>
          The IDE for engineers training{" "}
          <span className={styles.titleEm}>
            robot policies in simulation.
          </span>
        </Heading>
        <p className={styles.subtitle}>
          You already have a sim. You already have an experiment tracker.
          You already have an LLM coding assistant. What you don't have is
          the thing that <strong>understands all three at once</strong>,
          watches your training runs, and helps when they go sideways.
        </p>
        <div className={styles.buttons}>
          <Link className={styles.cta} to="/docs/dev_setup">
            Get Range running →
          </Link>
          <Link className={styles.ctaSecondary} to="/docs/user_guide">
            User guide
          </Link>
          <Link
            className={styles.ctaSecondary}
            href="https://github.com/rangeai/range"
          >
            GitHub ↗
          </Link>
        </div>
      </div>
    </header>
  );
}

interface FeatureCardProps {
  badge: string;
  title: string;
  body: string;
  link?: { to: string; label: string };
}

function FeatureCard({
  badge,
  title,
  body,
  link,
}: FeatureCardProps): ReactNode {
  return (
    <article className={styles.card}>
      <div className={styles.cardBadge}>{badge}</div>
      <h3 className={styles.cardTitle}>{title}</h3>
      <p className={styles.cardBody}>{body}</p>
      {link && (
        <Link className={styles.cardLink} to={link.to}>
          {link.label} →
        </Link>
      )}
    </article>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.features}>
      <div className={styles.featuresInner}>
        <FeatureCard
          badge="auto-scaffold"
          title="Drop in any Python repo. Scenarios in 30 seconds."
          body="Range detects the stack (MuJoCo Playground, Isaac Lab, or generic Python) and proposes a complete range.yaml — commands, scenarios, reward-fn pointers, a shim where it helps. You accept, edit, or dismiss."
          link={{ to: "/docs/user_guide", label: "See it on SB3-zoo" }}
        />
        <FeatureCard
          badge="/investigate"
          title="Trajectories that NaN out tell you exactly where."
          body="Walks events.jsonl, finds the first contaminated tick, captures the last 5 clean + first 5 corrupt anchors, hands Codex a structured report. Hits under 5 turns to root-cause on planted Playground fixtures."
          link={{ to: "/docs/playground_fixtures", label: "Proof harness" }}
        />
        <FeatureCard
          badge="/wire"
          title="The Hydra + W&B foot-guns, patched in one card."
          body="Scans your repo for the three canonical broken patterns (start_method, DictConfig serialization, sweep group key), proposes per-file diffs, accepts inline. Same pattern for any future canonical-pain integration."
        />
        <FeatureCard
          badge="agentic-only"
          title="One chat. No tab-switching to W&B and back."
          body="Codex (or OpenCode) is the primary surface. Range pre-loads it with context the agent can't get alone — profile, scenarios, reward functions as first-class entities, trajectory data, run metrics."
          link={{ to: "/blog", label: "Engineering notes" }}
        />
      </div>
    </section>
  );
}

function ProofStrip(): ReactNode {
  return (
    <section className={styles.proof}>
      <div className={styles.proofInner}>
        <div className={styles.proofKicker}>Proof harness</div>
        <p className={styles.proofBody}>
          Range's depth claims are measured against{" "}
          <a
            href="https://github.com/rangeai/mujoco_playground"
            className={styles.inlineLink}
          >
            rangeai/mujoco_playground
          </a>{" "}
          — a narrowly-diverged fork of upstream Playground with planted
          fixture branches. Each fixture is one realistic bug, one Range
          run, one raw-Codex baseline, one writeup. No mocks.
        </p>
        <Link className={styles.proofLink} to="/docs/playground_fixtures">
          See the fixture catalog →
        </Link>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Range — agentic IDE for sim-RL"
      description="The agentic IDE for engineers training robot policies in simulation. Auto-scaffolds any Python repo; finds NaN bugs faster than raw Codex; patches the canonical foot-guns."
    >
      <HeroBanner />
      <Features />
      <ProofStrip />
    </Layout>
  );
}
