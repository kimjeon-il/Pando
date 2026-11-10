# Temporary raw map workspace

User approved an isolated workspace on their PC to protect concurrent LOD work. This branch only adopts existing raw LSIB geometry into existing map sources; it does not change LOD algorithms, main or deployment.

App branch/worktree: work/gis-raw-modern, D:/dev/worktrees/gis-raw-modern.
Data branch/worktree: work/gis-raw-modern, D:/dev/PandoLab-library-data/.pando-worktrees/gis-raw-modern.
The narrowly scoped owner-name addition exists only on this branch to isolate materialization and write leases from work/gis. Remove this temporary owner support on integration rather than permanently expanding workspace policy.

User cleanup instruction: delete this temporary workspace AFTER a verified merge into main. This is not permission to merge now. Before later removal verify all data, reports, local commits, and any untracked work are integrated or preserved. Do not delete while the merge is pending.

JAM and MDG raw originals were adopted losslessly; existing identity, periods and parent relations are preserved. Source-only data commit:019bcfb510d0b35cad360ec18e3b9183fd7c8e17. Exactly two descriptors and two new immutable coordinate resources changed; no archive paths deleted. All four read back equal. No generated rendering artifacts or remote publication.
