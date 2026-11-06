//! Fixed-capacity ordered observation queue that records lost ranges as gaps.

use std::collections::VecDeque;
use std::fmt;

use native_protocol::{SequenceGap, SourceTimestamp};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SequencedObservation<T> {
    pub sequence: u64,
    pub observed_at: SourceTimestamp,
    pub gap: Option<SequenceGap>,
    pub payload: T,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuePushOutcome {
    pub sequence: u64,
    pub dropped: Option<SequenceGap>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueError {
    InvalidCapacity,
    Stopped,
}

impl fmt::Display for QueueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCapacity => formatter.write_str("queue capacity must be at least two"),
            Self::Stopped => formatter.write_str("source queue is stopped"),
        }
    }
}

impl std::error::Error for QueueError {}

#[derive(Debug)]
pub struct BoundedObservationQueue<T> {
    capacity: usize,
    next_sequence: u64,
    stopped: bool,
    observations: VecDeque<SequencedObservation<T>>,
    pending_gap: Option<SequenceGap>,
    last_observed_at_ns: u64,
}

impl<T> BoundedObservationQueue<T> {
    /// Creates a fixed-capacity ordered observation queue.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::InvalidCapacity`] when capacity is less than two,
    /// because overflow needs room for both a surviving record and a new one.
    pub fn new(capacity: usize) -> Result<Self, QueueError> {
        if capacity < 2 {
            return Err(QueueError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            next_sequence: 1,
            stopped: false,
            observations: VecDeque::with_capacity(capacity),
            pending_gap: None,
            last_observed_at_ns: 0,
        })
    }

    /// Adds one observation and assigns its monotonic source sequence.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::Stopped`] after disposal. An invalid internal
    /// capacity is also reported defensively rather than panicking.
    pub fn push(
        &mut self,
        mut observed_at: SourceTimestamp,
        payload: T,
    ) -> Result<QueuePushOutcome, QueueError> {
        if self.stopped {
            return Err(QueueError::Stopped);
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let dropped = if self.observations.len() == self.capacity {
            let Some(dropped) = self.observations.pop_front() else {
                return Err(QueueError::InvalidCapacity);
            };
            let first_missing = dropped
                .gap
                .as_ref()
                .map_or(dropped.sequence, |gap| gap.first_missing);
            let last_missing = dropped.sequence;
            let Some(next) = self.observations.front_mut() else {
                return Err(QueueError::InvalidCapacity);
            };
            let dropped = merge_gap(next.gap.take(), first_missing, last_missing);
            next.gap = Some(dropped.clone());
            Some(dropped)
        } else {
            None
        };
        observed_at.monotonic_time_ns = observed_at.monotonic_time_ns.max(self.last_observed_at_ns);
        self.last_observed_at_ns = observed_at.monotonic_time_ns;
        self.observations.push_back(SequencedObservation {
            sequence,
            observed_at,
            gap: self.pending_gap.take(),
            payload,
        });
        Ok(QueuePushOutcome { sequence, dropped })
    }

    /// Reserves source sequence numbers for facts that could not be retained.
    /// The missing range is attached to the next observation that can be
    /// delivered.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::Stopped`] after disposal.
    pub fn record_missing(&mut self, count: u64) -> Result<Option<SequenceGap>, QueueError> {
        if self.stopped {
            return Err(QueueError::Stopped);
        }
        if count == 0 {
            return Ok(None);
        }
        let first_missing = self.next_sequence;
        let last_missing = first_missing.saturating_add(count.saturating_sub(1));
        self.next_sequence = last_missing.saturating_add(1);
        let gap = merge_gap(self.pending_gap.take(), first_missing, last_missing);
        self.pending_gap = Some(gap.clone());
        Ok(Some(gap))
    }

    pub fn drain(&mut self) -> Vec<SequencedObservation<T>> {
        self.observations.drain(..).collect()
    }

    pub fn stop(&mut self) {
        self.stopped = true;
        self.observations.clear();
        self.pending_gap = None;
    }

    #[must_use]
    pub fn is_stopped(&self) -> bool {
        self.stopped
    }

    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.observations.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.observations.is_empty()
    }
}

fn merge_gap(existing: Option<SequenceGap>, first_missing: u64, last_missing: u64) -> SequenceGap {
    existing.map_or(
        SequenceGap {
            first_missing,
            last_missing,
        },
        |gap| SequenceGap {
            first_missing: gap.first_missing.min(first_missing),
            last_missing: gap.last_missing.max(last_missing),
        },
    )
}
