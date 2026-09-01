# Sherpa streaming model files

Place a compatible streaming Zipformer Transducer model in this directory using these filenames:

```text
encoder.onnx
decoder.onnx
joiner.onnx
tokens.txt
bpe.vocab
```

The BPE vocabulary is required when contextual biasing is enabled for an English model. An optional contextual-biasing file can be provided as:

```text
hotwords.txt
```

The model files are runtime resources and must not be committed to source control unless their license and repository policy explicitly permit it.

The worker uses CPU inference, two threads, 16 kHz features, feature dimension 80, endpoint detection, and `modified_beam_search`.
