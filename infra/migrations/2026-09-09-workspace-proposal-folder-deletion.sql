-- A folder that began as a workspace proposal could not be deleted: the
-- proposal kept a plain reference to the project it created, so removing the
-- project row failed after its history and stored files were already gone.
-- The proposal now simply forgets the folder when the folder goes.
ALTER TABLE workspace_proposals
  DROP CONSTRAINT IF EXISTS workspace_proposals_created_project_id_fkey;
ALTER TABLE workspace_proposals
  ADD CONSTRAINT workspace_proposals_created_project_id_fkey
  FOREIGN KEY (created_project_id) REFERENCES projects(id) ON DELETE SET NULL;
