//! Runs of needle points as the model sews them. The TypeScript marks some runs by identity (a trim
//! asked for before them, a stop of the machine before them); here the marks go with the run, and
//! a copy of a run (as `slice()` makes there) starts without them.

use crate::geom::Pt;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Run {
    pub pts: Vec<Pt>,
    /// A trim before it wherever it starts (trimBefore in restitch.ts).
    pub trim: bool,
    /// The machine stops before it (stopBefore in applique.ts).
    pub stop: bool,
}

impl Run {
    pub fn new(pts: Vec<Pt>) -> Run {
        Run {
            pts,
            trim: false,
            stop: false,
        }
    }

    pub fn len(&self) -> usize {
        self.pts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pts.is_empty()
    }

    pub fn last(&self) -> Option<Pt> {
        self.pts.last().copied()
    }
}

/// The last point of the last run.
pub fn end_of(runs: &[Run]) -> Option<Pt> {
    runs.last().and_then(|r| r.last())
}
