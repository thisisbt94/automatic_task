export type Frequency = "Daily" | "Weekly" | "Monthly" | "Occasionally";
export type TimeSpent = "<15 minutes" | "15–30 minutes" | "30–60 minutes" | "1–3 hours" | "3+ hours";
export type Sensitive = "Yes" | "No" | "Not sure";
export type AutomationPotential = "High" | "Medium" | "Low";
export type Difficulty = "Low" | "Medium" | "High";

export interface WorkflowStep {
  step: number;
  label: string;
  description: string;
}

export interface AnalysisResult {
  needsClarification?: false;
  taskSummary: string;
  category: string;
  automationPotential: AutomationPotential;
  automationScore: number;
  why: string;
  automatableSteps: string[];
  humanStillNeededFor: string[];
  suggestedWorkflow: WorkflowStep[];
  difficulty: Difficulty;
  possibleTools: string[];
  estimatedBenefit: string;
  nextStep: string;
  followUpQuestions: string[];
}

export interface ClarificationNeeded {
  needsClarification: true;
  question: string;
}

export type IlmuResponse = AnalysisResult | ClarificationNeeded;

export interface ClarificationTurn {
  question: string;
  answer: string;
}

export interface AnalyseTaskInput {
  sessionId: string;
  task: string;
  frequency: Frequency;
  timeSpent: TimeSpent;
  sensitive: Sensitive;
  clarificationHistory: ClarificationTurn[];
  department?: string;
}
