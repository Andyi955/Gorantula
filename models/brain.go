package models

// BrainFiredMessageType is broadcast when evidence landing caused brain
// synapses to fire for an investigation. The payload is a
// brainmemory.EvidenceFiring (kept out of models to avoid an import cycle).
const BrainFiredMessageType = "BRAIN_FIRED"
