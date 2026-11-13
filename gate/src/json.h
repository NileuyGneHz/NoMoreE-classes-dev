// 最小 JSON 读写（无第三方依赖）。只覆盖门禁输入输出的语法子集：
// object / array / string / number / true / false / null。
// 字符串支持 \" \\ \/ \b \f \n \r \t 与 \uXXXX（含代理对，按 UTF-8 输出）。
#pragma once

#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace gate {

struct Json {
    enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
    bool b = false;
    double n = 0;
    std::string s;
    std::vector<Json> items;                       // Arr
    std::vector<std::pair<std::string, Json>> fields;  // Obj

    bool isNull() const { return type == Null; }

    const Json* get(const std::string& key) const {
        if (type != Obj) return nullptr;
        for (const auto& f : fields) {
            if (f.first == key) return &f.second;
        }
        return nullptr;
    }
    std::string getStr(const std::string& key, const std::string& fallback = "") const {
        const Json* v = get(key);
        return (v != nullptr && v->type == Str) ? v->s : fallback;
    }
    bool getBool(const std::string& key, bool fallback = false) const {
        const Json* v = get(key);
        return (v != nullptr && v->type == Bool) ? v->b : fallback;
    }
    double getNum(const std::string& key, double fallback = 0) const {
        const Json* v = get(key);
        return (v != nullptr && v->type == Num) ? v->n : fallback;
    }
    bool has(const std::string& key) const { return get(key) != nullptr; }
};

namespace detail {

inline void appendUtf8(std::string& out, unsigned cp) {
    if (cp <= 0x7F) {
        out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

struct Parser {
    const std::string& text;
    size_t pos = 0;
    std::string err;

    explicit Parser(const std::string& t) : text(t) {}

    void fail(const std::string& message) {
        if (err.empty()) {
            err = message + " at offset " + std::to_string(pos);
        }
    }
    void skipWs() {
        while (pos < text.size()) {
            const char c = text[pos];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos;
            } else {
                break;
            }
        }
    }
    bool parseValue(Json& out) {
        skipWs();
        if (pos >= text.size()) {
            fail("unexpected end of input");
            return false;
        }
        const char c = text[pos];
        if (c == '{') return parseObject(out);
        if (c == '[') return parseArray(out);
        if (c == '"') {
            out.type = Json::Str;
            return parseString(out.s);
        }
        if (c == 't' || c == 'f') return parseBool(out);
        if (c == 'n') return parseNull(out);
        return parseNumber(out);
    }
    bool parseObject(Json& out) {
        out.type = Json::Obj;
        ++pos;  // '{'
        skipWs();
        if (pos < text.size() && text[pos] == '}') {
            ++pos;
            return true;
        }
        for (;;) {
            skipWs();
            if (pos >= text.size() || text[pos] != '"') {
                fail("object key must be a string");
                return false;
            }
            std::string key;
            if (!parseString(key)) return false;
            skipWs();
            if (pos >= text.size() || text[pos] != ':') {
                fail("expected ':' after object key");
                return false;
            }
            ++pos;
            Json value;
            if (!parseValue(value)) return false;
            out.fields.emplace_back(std::move(key), std::move(value));
            skipWs();
            if (pos >= text.size()) {
                fail("unterminated object");
                return false;
            }
            if (text[pos] == ',') {
                ++pos;
                continue;
            }
            if (text[pos] == '}') {
                ++pos;
                return true;
            }
            fail("expected ',' or '}'");
            return false;
        }
    }
    bool parseArray(Json& out) {
        out.type = Json::Arr;
        ++pos;  // '['
        skipWs();
        if (pos < text.size() && text[pos] == ']') {
            ++pos;
            return true;
        }
        for (;;) {
            Json value;
            if (!parseValue(value)) return false;
            out.items.push_back(std::move(value));
            skipWs();
            if (pos >= text.size()) {
                fail("unterminated array");
                return false;
            }
            if (text[pos] == ',') {
                ++pos;
                continue;
            }
            if (text[pos] == ']') {
                ++pos;
                return true;
            }
            fail("expected ',' or ']'");
            return false;
        }
    }
    bool parseBool(Json& out) {
        if (text.compare(pos, 4, "true") == 0) {
            out.type = Json::Bool;
            out.b = true;
            pos += 4;
            return true;
        }
        if (text.compare(pos, 5, "false") == 0) {
            out.type = Json::Bool;
            out.b = false;
            pos += 5;
            return true;
        }
        fail("invalid literal");
        return false;
    }
    bool parseNull(Json& out) {
        if (text.compare(pos, 4, "null") == 0) {
            out.type = Json::Null;
            pos += 4;
            return true;
        }
        fail("invalid literal");
        return false;
    }
    bool parseNumber(Json& out) {
        const size_t start = pos;
        if (pos < text.size() && (text[pos] == '-' || text[pos] == '+')) ++pos;
        bool digits = false;
        while (pos < text.size() && text[pos] >= '0' && text[pos] <= '9') {
            ++pos;
            digits = true;
        }
        if (pos < text.size() && text[pos] == '.') {
            ++pos;
            while (pos < text.size() && text[pos] >= '0' && text[pos] <= '9') {
                ++pos;
                digits = true;
            }
        }
        if (digits && pos < text.size() && (text[pos] == 'e' || text[pos] == 'E')) {
            ++pos;
            if (pos < text.size() && (text[pos] == '-' || text[pos] == '+')) ++pos;
            while (pos < text.size() && text[pos] >= '0' && text[pos] <= '9') ++pos;
        }
        if (!digits) {
            fail("invalid number");
            return false;
        }
        out.type = Json::Num;
        out.n = std::strtod(text.substr(start, pos - start).c_str(), nullptr);
        return true;
    }
    bool readHex4(unsigned& value) {
        if (pos + 4 > text.size()) {
            fail("truncated \\u escape");
            return false;
        }
        value = 0;
        for (int k = 0; k < 4; ++k) {
            const char c = text[pos + k];
            unsigned digit;
            if (c >= '0' && c <= '9') digit = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') digit = static_cast<unsigned>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') digit = static_cast<unsigned>(c - 'A' + 10);
            else {
                fail("invalid \\u escape");
                return false;
            }
            value = (value << 4) | digit;
        }
        pos += 4;
        return true;
    }
    bool parseString(std::string& out) {
        ++pos;  // opening quote
        out.clear();
        while (pos < text.size()) {
            const char c = text[pos];
            if (c == '"') {
                ++pos;
                return true;
            }
            if (c == '\\') {
                ++pos;
                if (pos >= text.size()) break;
                const char esc = text[pos++];
                switch (esc) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    case 'u': {
                        unsigned high = 0;
                        if (!readHex4(high)) return false;
                        unsigned cp = high;
                        if (high >= 0xD800 && high <= 0xDBFF && pos + 6 <= text.size()
                            && text[pos] == '\\' && text[pos + 1] == 'u') {
                            pos += 2;
                            unsigned low = 0;
                            if (!readHex4(low)) return false;
                            cp = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
                        }
                        detail::appendUtf8(out, cp);
                        break;
                    }
                    default:
                        fail("invalid escape");
                        return false;
                }
                continue;
            }
            out.push_back(c);
            ++pos;
        }
        fail("unterminated string");
        return false;
    }
};

}  // namespace detail

inline bool parseJson(const std::string& text, Json& out, std::string& err) {
    detail::Parser parser(text);
    if (!parser.parseValue(out)) {
        err = parser.err;
        return false;
    }
    parser.skipWs();
    if (parser.pos != text.size()) {
        err = "trailing characters at offset " + std::to_string(parser.pos);
        return false;
    }
    return true;
}

inline std::string jsonQuote(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 2);
    out.push_back('"');
    for (const char ch : in) {
        const unsigned char c = static_cast<unsigned char>(ch);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out.push_back(ch);
                }
        }
    }
    out.push_back('"');
    return out;
}

}  // namespace gate
