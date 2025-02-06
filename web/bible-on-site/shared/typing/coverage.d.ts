interface Position {
  line: number;
  column: number;
}

interface PositionRange {
  start: Position;
  end: Position;
}

interface StatementLocation extends PositionRange {}

interface FunctionCoverage {
  name: string;
  decl: PositionRange;
  loc: PositionRange;
  line: number;
}

interface BranchCoverage {
  loc: PositionRange;
  type: string;
  locations: PositionRange[];
  line: number;
}

interface FileCoverage {
  all: boolean;
  path: string;
  statementMap: { [statementId: string]: StatementLocation };
  fnMap: { [fnId: string]: FunctionCoverage };
  branchMap: { [branchId: string]: BranchCoverage };
  s: { [statementId: string]: number };
  f: { [fnId: string]: number };
  b: { [branchId: string]: number[] };
  _coverageSchema: string;
  hash: string;
}

interface CoverageData {
  [filePath: string]: FileCoverage;
}
