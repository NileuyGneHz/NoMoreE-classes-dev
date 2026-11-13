#include "bt.h"

#include <algorithm>
#include <cctype>
#include <cstring>

namespace gate {

namespace {

std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

bool endsWith(const std::string& value, const std::string& suffix) {
    return value.size() >= suffix.size()
        && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool isCondOp(const std::string& op) {
    return op == "url_known" || op == "skill_present" || op == "page_state_ok";
}

bool isActOp(const std::string& op) {
    return op == "allow" || op == "ask_user" || op == "deny";
}

void addReason(Ctx& ctx, const std::string& text) { ctx.reasons.push_back(text); }

}  // namespace

bool splitUrl(const std::string& url, std::string& host, std::string& path) {
    std::string rest = url;
    const size_t scheme = rest.find("://");
    if (scheme != std::string::npos) rest = rest.substr(scheme + 3);
    const size_t slash = rest.find('/');
    std::string authority = rest.substr(0, slash);
    path = (slash == std::string::npos) ? "/" : rest.substr(slash);

    const size_t at = authority.find('@');
    if (at != std::string::npos) authority = authority.substr(at + 1);

    if (!authority.empty() && authority[0] == '[') {  // IPv6
        const size_t close = authority.find(']');
        if (close != std::string::npos) authority = authority.substr(1, close - 1);
    } else {
        const size_t colon = authority.find(':');
        if (colon != std::string::npos) authority = authority.substr(0, colon);
    }

    const size_t cut = path.find_first_of("?#");
    if (cut != std::string::npos) path = path.substr(0, cut);

    host = lower(authority);
    if (host.empty()) return false;

    // 只接受 host 允许的字符；必须像域名（含点）或 localhost。
    for (const char c : host) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.';
        if (!ok) return false;
    }
    if (host != "localhost" && host.find('.') == std::string::npos) return false;
    return true;
}

bool hostMatches(const std::string& host, const std::string& pattern) {
    const std::string h = lower(host);
    const std::string p = lower(pattern);
    if (p.size() > 2 && p.compare(0, 2, "*.") == 0) {
        const std::string suffix = p.substr(1);   // ".zhihuishu.com"
        if (endsWith(h, suffix)) return true;
        return h == suffix.substr(1);             // 允许裸域
    }
    return h == p;
}

bool parseSites(const Json& root, std::vector<Site>& out, std::string& err) {
    const Json* arr = &root;
    if (root.type == Json::Obj) arr = root.get("sites");
    if (arr == nullptr || arr->type != Json::Arr) {
        err = "sites: expected {\"sites\":[...]} or an array";
        return false;
    }
    out.clear();
    for (size_t i = 0; i < arr->items.size(); ++i) {
        const Json& item = arr->items[i];
        const std::string where = "sites[" + std::to_string(i) + "]";
        if (item.type != Json::Obj) {
            err = where + ": expected object";
            return false;
        }
        Site site;
        site.id = item.getStr("id");
        site.skill = item.getStr("skill");
        if (site.id.empty()) {
            err = where + ": missing id";
            return false;
        }
        const Json* match = item.get("match");
        const Json* hosts = match != nullptr ? match->get("hosts") : nullptr;
        if (hosts == nullptr || hosts->type != Json::Arr || hosts->items.empty()) {
            err = where + ": match.hosts must be a non-empty array";
            return false;
        }
        for (const Json& h : hosts->items) {
            if (h.type != Json::Str) {
                err = where + ": match.hosts entries must be strings";
                return false;
            }
            site.hosts.push_back(h.s);
        }
        const Json* prefixes = match->get("pathPrefixes");
        if (prefixes != nullptr && prefixes->type == Json::Arr) {
            for (const Json& p : prefixes->items) {
                if (p.type != Json::Str) {
                    err = where + ": match.pathPrefixes entries must be strings";
                    return false;
                }
                site.pathPrefixes.push_back(p.s);
            }
        }
        const Json* tools = item.get("tools");
        if (tools != nullptr && tools->type == Json::Arr) {
            for (const Json& t : tools->items) {
                if (t.type == Json::Str) site.tools.push_back(t.s);
            }
        }
        for (const Site& existing : out) {
            if (existing.id == site.id) {
                err = where + ": duplicate site id '" + site.id + "'";
                return false;
            }
        }
        out.push_back(std::move(site));
    }
    return true;
}

NodePtr buildTree(const Json& j, std::string& err) {
    if (j.type != Json::Obj) {
        err = "tree node: expected object";
        return nullptr;
    }
    const std::string type = j.getStr("type");
    NodePtr node(new Node());
    if (type == "sequence") {
        node->kind = Node::Seq;
    } else if (type == "selector") {
        node->kind = Node::Sel;
    } else if (type == "cond") {
        node->kind = Node::Cond;
    } else if (type == "act") {
        node->kind = Node::Act;
    } else {
        err = "tree node: unknown type '" + type + "'";
        return nullptr;
    }

    if (node->kind == Node::Seq || node->kind == Node::Sel) {
        const Json* children = j.get("children");
        if (children == nullptr || children->type != Json::Arr || children->items.empty()) {
            err = "tree " + type + ": children must be a non-empty array";
            return nullptr;
        }
        for (const Json& child : children->items) {
            NodePtr built = buildTree(child, err);
            if (built == nullptr) return nullptr;
            node->children.push_back(std::move(built));
        }
        return node;
    }

    node->op = j.getStr("op");
    if (node->op.empty()) {
        err = "tree " + type + ": missing op";
        return nullptr;
    }
    const bool known = (node->kind == Node::Cond) ? isCondOp(node->op) : isActOp(node->op);
    if (!known) {
        err = "tree " + type + ": unknown op '" + node->op + "'";
        return nullptr;
    }
    return node;
}

bool validateTree(const Node& node, std::string& err) {
    if (node.kind == Node::Seq || node.kind == Node::Sel) {
        for (const NodePtr& child : node.children) {
            if (!validateTree(*child, err)) return false;
        }
        return true;
    }
    const bool known = (node.kind == Node::Cond) ? isCondOp(node.op) : isActOp(node.op);
    if (!known) {
        err = "tree: unknown op '" + node.op + "'";
        return false;
    }
    return true;
}

bool eval(const Node& node, Ctx& ctx) {
    switch (node.kind) {
        case Node::Seq:
            for (const NodePtr& child : node.children) {
                if (!eval(*child, ctx)) return false;
            }
            return true;
        case Node::Sel:
            for (const NodePtr& child : node.children) {
                if (eval(*child, ctx)) return true;
            }
            return false;
        case Node::Cond: {
            if (node.op == "url_known") {
                const Site* hit = nullptr;
                for (const Site& site : ctx.sites) {
                    bool hostOk = false;
                    for (const std::string& pattern : site.hosts) {
                        if (hostMatches(ctx.host, pattern)) {
                            hostOk = true;
                            break;
                        }
                    }
                    if (!hostOk) continue;
                    bool pathOk = site.pathPrefixes.empty();
                    for (const std::string& prefix : site.pathPrefixes) {
                        if (ctx.path.compare(0, prefix.size(), prefix) == 0) {
                            pathOk = true;
                            break;
                        }
                    }
                    if (pathOk) {
                        hit = &site;
                        break;
                    }
                }
                if (hit == nullptr) {
                    ctx.reason = "unknown_site";
                    addReason(ctx, "url_known: no site matched host=" + ctx.host + " path=" + ctx.path);
                    return false;
                }
                ctx.site = hit;
                ctx.skill = hit->skill;
                addReason(ctx, "url_known: " + hit->id);
                return true;
            }
            if (node.op == "skill_present") {
                if (ctx.skill.empty()) {
                    ctx.reason = "site_has_no_skill";
                    addReason(ctx, "skill_present: site has no skill");
                    return false;
                }
                if (!ctx.skillsKnown) {
                    addReason(ctx, "skill_present: unchecked (skills service unavailable)");
                    return true;
                }
                const bool found = std::find(ctx.installedSkills.begin(), ctx.installedSkills.end(),
                                             ctx.skill) != ctx.installedSkills.end();
                if (!found) {
                    ctx.reason = "skill_missing:" + ctx.skill;
                    addReason(ctx, "skill_present: " + ctx.skill + " not installed");
                } else {
                    addReason(ctx, "skill_present: " + ctx.skill);
                }
                return found;
            }
            if (node.op == "page_state_ok") {
                if (!ctx.pageReady) {
                    ctx.reason = "page_state_not_ready";
                    addReason(ctx, "page_state_ok: false");
                }
                return ctx.pageReady;
            }
            addReason(ctx, "cond: unknown op " + node.op);
            return false;
        }
        case Node::Act: {
            if (node.op == "allow") {
                ctx.decision = "allow";
                if (ctx.reason.empty()) ctx.reason = "allowed";
                addReason(ctx, "allow: " + (ctx.site != nullptr ? ctx.site->id : std::string("?")));
                return true;
            }
            if (node.op == "ask_user") {
                ctx.decision = "ask_user";
                if (ctx.reason.empty()) ctx.reason = "unknown_site";
                addReason(ctx, "ask_user: " + ctx.reason);
                return true;
            }
            if (node.op == "deny") {
                ctx.decision = "deny";
                if (ctx.reason.empty()) ctx.reason = "denied";
                addReason(ctx, "deny: " + ctx.reason);
                return true;
            }
            addReason(ctx, "act: unknown op " + node.op);
            return false;
        }
    }
    return false;
}

std::string resultJson(const Ctx& ctx) {
    std::string out = "{\"decision\":" + jsonQuote(ctx.decision);
    out += ",\"site\":" + jsonQuote(ctx.site != nullptr ? ctx.site->id : "");
    out += ",\"skill\":" + jsonQuote(ctx.skill);
    out += ",\"allowedTools\":[";
    if (ctx.site != nullptr) {
        for (size_t i = 0; i < ctx.site->tools.size(); ++i) {
            if (i) out.push_back(',');
            out += jsonQuote(ctx.site->tools[i]);
        }
    }
    out += "],\"reason\":" + jsonQuote(ctx.reason);
    out += ",\"reasons\":[";
    for (size_t i = 0; i < ctx.reasons.size(); ++i) {
        if (i) out.push_back(',');
        out += jsonQuote(ctx.reasons[i]);
    }
    out += "]}";
    return out;
}

}  // namespace gate
