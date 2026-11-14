//! The deterministic core of the native agent: sessions, sequencing, gaps, resets, flow control
//! and rule evaluation, once for every capability. It has no OS code, no threads and no clock.
#![forbid(unsafe_code)]

pub mod engine;
pub mod evaluate;
pub mod observation;
pub mod policy;
pub mod registry;
pub mod source;

#[cfg(any(test, feature = "testing"))]
pub mod testing;
#[cfg(any(test, feature = "vectors"))]
pub mod vectors;

pub use engine::{CoreError, Engine, InitialState, Input, MAX_UNACKNOWLEDGED, Numbered};
pub use observation::{AppMatches, FieldValue, Observation};
pub use policy::{PolicyError, ValidPolicy};
pub use registry::{CapabilityDescriptor, FieldKind, FieldSpec, RegisteredApplication, Registry};
pub use source::{Sink, Source, SourceError, SourceEvent};
