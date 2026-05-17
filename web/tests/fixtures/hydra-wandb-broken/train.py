"""Canonical broken Hydra + W&B integration.

This fixture exercises three foot-guns the /wire wandb-hydra helper
should fix:

  1. `wandb.init()` without `settings=wandb.Settings(start_method="thread")`
     — hangs when launched via Hydra.
  2. `wandb.init(..., config=cfg)` — DictConfig passed directly; W&B
     can't serialize it.
  3. `wandb.config.update(cfg)` — same DictConfig problem.
"""

import hydra
import wandb


@hydra.main(version_base=None, config_path="conf", config_name="config")
def main(cfg):
    # Bug 1 + 2: bare wandb.init with DictConfig.
    run = wandb.init(
        project=cfg.project,
        config=cfg,
    )

    # Bug 3: wandb.config.update with DictConfig.
    wandb.config.update(cfg)

    # A normal log call (already safe).
    wandb.log({"reward": 0.0, "step": 0})

    run.finish()


if __name__ == "__main__":
    main()
