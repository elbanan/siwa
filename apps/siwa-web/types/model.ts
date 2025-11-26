export type ModelEntry = {
  id: string;
  name: string;
  source_type: string;
  source_config: Record<string, any>;
  status: string;
  error_message?: string | null;
  checksum?: string | null;
  details: Record<string, any>;
  created_at: string;
  updated_at?: string | null;
};
