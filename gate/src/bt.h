// 最小行为树：Sequence / Selector / Cond / Act 四类节点。
// 树从 JSON 加载，Cond/Act 的语义按 op 名查内置表；加节点只加 op，不改引擎。
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "json.h"

namespace gate {

struct Site {
    std::string id;
    std::string skill;
    std::vector<std::string> tools;
    std::vector<std::string> hosts;
    std::vector<std::string> pathPrefixes;
};

struct Ctx {
    std::string url;
    std::string host;
    std::string path;
    std::vector<Site> sites;
    std::vector<std::string> installedSkills;
    bool skillsKnown = true;   // false = 宿主没有技能服务，无法核验 skill_present
    bool pageReady = true;
    std::string decision = "ask_user";  // allow / ask_user / deny
    const Site* site = nullptr;
    std::string skill;
    std::vector<std::string> reasons;
    std::string reason;  // 面向人的一句话
};

struct Node;
using NodePtr = std::unique_ptr<Node>;

struct Node {
    enum Kind { Seq, Sel, Cond, Act } kind = Act;
    std::string op;
    std::vector<NodePtr> children;
};

bool splitUrl(const std::string& url, std::string& host, std::string& path);
bool hostMatches(const std::string& host, const std::string& pattern);
bool parseSites(const Json& root, std::vector<Site>& out, std::string& err);
NodePtr buildTree(const Json& node, std::string& err);
bool validateTree(const Node& node, std::string& err);
bool eval(const Node& node, Ctx& ctx);
std::string resultJson(const Ctx& ctx);

}  // namespace gate
