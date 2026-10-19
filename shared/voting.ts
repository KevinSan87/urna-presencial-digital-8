export type VotingStatus = "open" | "closed";

export interface VotingConfig {
  name: string;
  logo: string | null;
  status: VotingStatus;
  sheetsUrl: string;
  sheetsId: string;
  sheetsTab: string;
  sheetsBaseline: number;
  updatedAt?: string;
}

export interface VotingGroup {
  id: string;
  name: string;
  logo: string | null;
  description: string;
  active: boolean;
  createdAt: string;
}

export interface VoteRecord {
  id: string;
  groupId: string;
  createdAt: string;
  requestId?: string;
  synced?: boolean;
}

export interface ResultRow {
  groupId: string;
  name: string;
  logo: string | null;
  votes: number;
  percentage: number;
  active: boolean;
}

export interface PublicVotingData {
  config: VotingConfig;
  groups: VotingGroup[];
}

export interface AdminOverview extends PublicVotingData {
  totalVotes: number;
  results: ResultRow[];
  lastVoteAt: string | null;
}
