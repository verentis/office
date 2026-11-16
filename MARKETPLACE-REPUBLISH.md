# Marketplace republish

Office is republished by every merge to `main` that changes `manifests/` or the hosted app: the release workflow
publishes it to the global production registry. To republish without a change (for example
after renewing publisher federation credentials), run the **Release** workflow manually with **everything** set.
