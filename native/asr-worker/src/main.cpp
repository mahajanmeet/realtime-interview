#include <cstdint>
#include <cstring>
#include <exception>
#include <iostream>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "sherpa-onnx/c-api/c-api.h"

namespace {

constexpr int32_t kSampleRate = 16000;
constexpr uint32_t kMaxSamplesPerFrame = 16000;
constexpr float kSpeechRmsThreshold = 0.004F;
constexpr uint64_t kResultGraceSamples = kSampleRate * 8U / 10U;
constexpr uint8_t kCommandStart = 1;
constexpr uint8_t kCommandAudio = 2;
constexpr uint8_t kCommandReset = 3;
constexpr uint8_t kCommandStop = 4;
constexpr uint8_t kMicrophoneSource = 1;
constexpr uint8_t kSystemSource = 2;

struct Options {
  std::string encoder;
  std::string decoder;
  std::string joiner;
  std::string tokens;
  std::string bpe_vocab;
  std::string hotwords;
  std::string provider = "cpu";
  std::string decoding_method = "modified_beam_search";
  int32_t threads = 2;
  float hotwords_score = 1.5F;
};

struct StreamState {
  const SherpaOnnxOnlineStream* stream = nullptr;
  uint64_t total_samples = 0;
  uint64_t segment_start_samples = 0;
  uint32_t segment_index = 0;
  uint64_t last_speech_samples = 0;
  bool has_detected_speech = false;
  std::string last_text;
};

using RecognizerPointer = std::unique_ptr<
    const SherpaOnnxOnlineRecognizer,
    decltype(&SherpaOnnxDestroyOnlineRecognizer)>;

bool ReadExact(char* destination, std::size_t length) {
  std::cin.read(destination, static_cast<std::streamsize>(length));
  return static_cast<std::size_t>(std::cin.gcount()) == length;
}

uint32_t ReadLittleEndianUint32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0]) |
         (static_cast<uint32_t>(bytes[1]) << 8U) |
         (static_cast<uint32_t>(bytes[2]) << 16U) |
         (static_cast<uint32_t>(bytes[3]) << 24U);
}

std::string JsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size());

  for (const unsigned char character : value) {
    switch (character) {
      case '"':
        escaped += "\\\"";
        break;
      case '\\':
        escaped += "\\\\";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (character < 0x20U) {
          escaped += " ";
        } else {
          escaped += static_cast<char>(character);
        }
    }
  }

  return escaped;
}

const char* SourceName(uint8_t source) {
  return source == kMicrophoneSource ? "microphone" : "system";
}

uint64_t SamplesToMilliseconds(uint64_t samples) {
  return samples * 1000U / static_cast<uint64_t>(kSampleRate);
}

void EmitStatus(const std::string& state, const std::string& message = "") {
  std::cout << "{\"type\":\"status\",\"state\":\"" << state << "\"";

  if (!message.empty()) {
    std::cout << ",\"message\":\"" << JsonEscape(message) << "\"";
  }

  std::cout << "}" << std::endl;
}

void EmitResult(uint8_t source, const StreamState& state, const std::string& type,
                const std::string& text, bool final) {
  std::cout << "{\"type\":\"" << type << "\",\"source\":\""
            << SourceName(source) << "\",\"segmentId\":\""
            << SourceName(source) << "-" << state.segment_index << "\",\"text\":\""
            << JsonEscape(text) << "\",\"startMs\":"
            << SamplesToMilliseconds(state.segment_start_samples) << ",\"endMs\":";

  if (final) {
    std::cout << SamplesToMilliseconds(state.total_samples);
  } else {
    std::cout << "null";
  }

  std::cout << "}" << std::endl;
}

bool IsValidSource(uint8_t source) {
  return source == kMicrophoneSource || source == kSystemSource;
}

Options ParseOptions(int argc, char** argv) {
  Options options;

  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    const std::size_t separator = argument.find('=');

    if (separator == std::string::npos || argument.rfind("--", 0) != 0) {
      continue;
    }

    const std::string key = argument.substr(2, separator - 2);
    const std::string value = argument.substr(separator + 1);

    if (key == "encoder") {
      options.encoder = value;
    } else if (key == "decoder") {
      options.decoder = value;
    } else if (key == "joiner") {
      options.joiner = value;
    } else if (key == "tokens") {
      options.tokens = value;
    } else if (key == "bpe-vocab") {
      options.bpe_vocab = value;
    } else if (key == "hotwords") {
      options.hotwords = value;
    } else if (key == "provider") {
      options.provider = value;
    } else if (key == "decoding-method") {
      options.decoding_method = value;
    } else if (key == "threads") {
      options.threads = std::stoi(value);
    } else if (key == "hotwords-score") {
      options.hotwords_score = std::stof(value);
    }
  }

  return options;
}

bool HasRequiredOptions(const Options& options) {
  return !options.encoder.empty() && !options.decoder.empty() &&
         !options.joiner.empty() && !options.tokens.empty();
}

RecognizerPointer CreateRecognizer(const Options& options) {
  SherpaOnnxOnlineRecognizerConfig config;
  std::memset(&config, 0, sizeof(config));

  config.model_config.transducer.encoder = options.encoder.c_str();
  config.model_config.transducer.decoder = options.decoder.c_str();
  config.model_config.transducer.joiner = options.joiner.c_str();
  config.model_config.tokens = options.tokens.c_str();
  config.model_config.modeling_unit = options.bpe_vocab.empty() ? "" : "bpe";
  config.model_config.bpe_vocab = options.bpe_vocab.c_str();
  config.model_config.num_threads = options.threads;
  config.model_config.provider = options.provider.c_str();
  config.model_config.debug = 0;
  config.feat_config.sample_rate = kSampleRate;
  config.feat_config.feature_dim = 80;
  config.decoding_method = options.decoding_method.c_str();
  config.max_active_paths = 4;
  config.enable_endpoint = 1;
  config.rule1_min_trailing_silence = 2.4F;
  config.rule2_min_trailing_silence = 2.0F;
  config.rule3_min_utterance_length = 300.0F;

  if (!options.hotwords.empty()) {
    config.hotwords_file = options.hotwords.c_str();
    config.hotwords_score = options.hotwords_score;
  }

  return RecognizerPointer(SherpaOnnxCreateOnlineRecognizer(&config),
                           &SherpaOnnxDestroyOnlineRecognizer);
}

bool StartStream(const SherpaOnnxOnlineRecognizer* recognizer, uint8_t source,
                 std::unordered_map<uint8_t, StreamState>* streams) {
  if (streams->find(source) != streams->end()) {
    return true;
  }

  const SherpaOnnxOnlineStream* stream = SherpaOnnxCreateOnlineStream(recognizer);

  if (stream == nullptr) {
    return false;
  }

  StreamState state;
  state.stream = stream;
  streams->emplace(source, std::move(state));
  return true;
}

void DecodeReady(const SherpaOnnxOnlineRecognizer* recognizer,
                 const SherpaOnnxOnlineStream* stream) {
  while (SherpaOnnxIsOnlineStreamReady(recognizer, stream) != 0) {
    SherpaOnnxDecodeOnlineStream(recognizer, stream);
  }
}

bool ContainsSpeech(const std::vector<float>& samples) {
  double energy = 0.0;

  for (const float sample : samples) {
    energy += static_cast<double>(sample) * static_cast<double>(sample);
  }

  const double mean_square = energy / static_cast<double>(samples.size());
  return mean_square >=
         static_cast<double>(kSpeechRmsThreshold) * static_cast<double>(kSpeechRmsThreshold);
}

bool IsWithinSpeechResultGrace(const StreamState& state) {
  return state.has_detected_speech &&
         state.total_samples - state.last_speech_samples <= kResultGraceSamples;
}

void FinalizeStream(const SherpaOnnxOnlineRecognizer* recognizer, uint8_t source,
                    StreamState* state) {
  SherpaOnnxOnlineStreamInputFinished(state->stream);
  DecodeReady(recognizer, state->stream);

  const SherpaOnnxOnlineRecognizerResult* result =
      SherpaOnnxGetOnlineStreamResult(recognizer, state->stream);
  const std::string decoded =
      result != nullptr && result->text != nullptr ? result->text : "";
  const std::string text = state->has_detected_speech
      ? (decoded.empty() ? state->last_text : decoded) : "";

  if (!text.empty()) {
    EmitResult(source, *state, "final", text, true);
  }

  if (result != nullptr) {
    SherpaOnnxDestroyOnlineRecognizerResult(result);
  }
}

void ResetAndDestroyStream(const SherpaOnnxOnlineRecognizer* recognizer, uint8_t source,
                           std::unordered_map<uint8_t, StreamState>* streams) {
  const auto iterator = streams->find(source);

  if (iterator == streams->end()) {
    return;
  }

  FinalizeStream(recognizer, source, &iterator->second);
  SherpaOnnxDestroyOnlineStream(iterator->second.stream);
  streams->erase(iterator);
}

void AcceptAudio(const SherpaOnnxOnlineRecognizer* recognizer, uint8_t source,
                 const std::vector<float>& samples,
                 std::unordered_map<uint8_t, StreamState>* streams) {
  if (!StartStream(recognizer, source, streams)) {
    return;
  }

  StreamState& state = streams->at(source);
  const bool contains_speech = ContainsSpeech(samples);

  if (contains_speech) {
    if (!state.has_detected_speech) {
      state.segment_start_samples = state.total_samples;
      state.has_detected_speech = true;
    }

    state.last_speech_samples = state.total_samples + samples.size();
  }

  SherpaOnnxOnlineStreamAcceptWaveform(state.stream, kSampleRate, samples.data(),
                                       static_cast<int32_t>(samples.size()));
  state.total_samples += samples.size();
  DecodeReady(recognizer, state.stream);

  const SherpaOnnxOnlineRecognizerResult* result =
      SherpaOnnxGetOnlineStreamResult(recognizer, state.stream);
  const std::string text =
      result != nullptr && result->text != nullptr ? result->text : "";
  const bool endpoint = SherpaOnnxOnlineStreamIsEndpoint(recognizer, state.stream) != 0;

  if (endpoint) {
    const std::string final_text = state.has_detected_speech
        ? (text.empty() ? state.last_text : text) : "";

    if (!final_text.empty()) {
      EmitResult(source, state, "final", final_text, true);
      ++state.segment_index;
    }

    SherpaOnnxOnlineStreamReset(recognizer, state.stream);
    state.segment_start_samples = state.total_samples;
    state.last_speech_samples = 0;
    state.has_detected_speech = false;
    state.last_text.clear();
  } else if (IsWithinSpeechResultGrace(state) && !text.empty() && text != state.last_text) {
    state.last_text = text;
    EmitResult(source, state, "partial", text, false);
  }

  if (result != nullptr) {
    SherpaOnnxDestroyOnlineRecognizerResult(result);
  }
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  if (_setmode(_fileno(stdin), _O_BINARY) == -1) {
    EmitStatus("error", "Could not enable binary stdin mode.");
    return 8;
  }
#endif

  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  try {
    const Options options = ParseOptions(argc, argv);

    if (!HasRequiredOptions(options)) {
      EmitStatus("error", "Required model paths were not supplied.");
      return 2;
    }

    RecognizerPointer recognizer = CreateRecognizer(options);

    if (!recognizer) {
      EmitStatus("error", "Sherpa recognizer could not be created.");
      return 3;
    }

    std::unordered_map<uint8_t, StreamState> streams;
    EmitStatus("ready");

    while (true) {
      uint8_t header[6];

      if (!ReadExact(reinterpret_cast<char*>(header), sizeof(header))) {
        break;
      }

      const uint8_t command = header[0];
      const uint8_t source = header[1];
      const uint32_t sample_count = ReadLittleEndianUint32(header + 2);

      if (command == kCommandStop) {
        break;
      }

      if (!IsValidSource(source)) {
        EmitStatus("error", "Invalid audio source.");
        return 4;
      }

      if (command == kCommandStart) {
        if (!StartStream(recognizer.get(), source, &streams)) {
          EmitStatus("error", "Sherpa stream could not be created.");
          return 5;
        }
        continue;
      }

      if (command == kCommandReset) {
        ResetAndDestroyStream(recognizer.get(), source, &streams);
        continue;
      }

      if (command != kCommandAudio || sample_count == 0 ||
          sample_count > kMaxSamplesPerFrame) {
        EmitStatus("error", "Invalid ASR protocol frame.");
        return 6;
      }

      std::vector<float> samples(sample_count);

      if (!ReadExact(reinterpret_cast<char*>(samples.data()),
                     samples.size() * sizeof(float))) {
        EmitStatus("error", "Incomplete ASR audio frame.");
        return 7;
      }

      AcceptAudio(recognizer.get(), source, samples, &streams);
    }

    for (auto& entry : streams) {
      FinalizeStream(recognizer.get(), entry.first, &entry.second);
      SherpaOnnxDestroyOnlineStream(entry.second.stream);
    }

    return 0;
  } catch (const std::exception& error) {
    EmitStatus("error", error.what());
    return 1;
  }
}
