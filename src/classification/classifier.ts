import { Category } from './categories';

export interface ClassifierInput {
  title: string;
  description: string;
}

export interface ClassifierResult {
  category: Category;
  // 0..1, 3 decimals.
  confidence: number;
  needsReview: boolean;
}

// What the worker depends on; the mock can be swapped for a real service.
export interface Classifier {
  classify(input: ClassifierInput): Promise<ClassifierResult>;
}

export const CLASSIFIER = Symbol('CLASSIFIER');
