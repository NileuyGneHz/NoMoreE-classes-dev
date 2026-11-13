// site_gate — 站点门禁决策进程。
// 协议：一行 JSON 进（stdin），一行 JSON 出（stdout）。单次 tick，无线程。
//   site_gate --json                    读 stdin 的 {url, sites?, tree?, skills?, ...} → 输出决策
//   site_gate --validate --sites F --tree F   静态校验站点表与行为树
//   site_gate --cases F --sites F --tree F    跑 golden 用例
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "bt.h"
#include "json.h"

namespace {

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::string();
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

std::string readStdin() {
    std::ostringstream ss;
    ss << std::cin.rdbuf();
    return ss.str();
}

int printError(const std::string& message) {
    std::cout << "{\"ok\":false,\"error\":" << gate::jsonQuote(message) << "}" << std::endl;
    return 2;
}

// 从输入对象里取 sites/tree：优先内联，其次文件。
bool loadSites(const gate::Json& input, const std::string& sitesFile,
               std::vector<gate::Site>& sites, std::string& err) {
    const gate::Json* inlineSites = input.get("sites");
    gate::Json fromFile;
    const gate::Json* source = inlineSites;
    if (source == nullptr) {
        if (sitesFile.empty()) {
            err = "missing sites (inline or --sites)";
            return false;
        }
        const std::string text = readFile(sitesFile);
        if (text.empty()) {
            err = "cannot read sites file: " + sitesFile;
            return false;
        }
        if (!gate::parseJson(text, fromFile, err)) return false;
        source = &fromFile;
    }
    return gate::parseSites(*source, sites, err);
}

bool loadTree(const gate::Json& input, const std::string& treeFile,
              gate::NodePtr& tree, std::string& err) {
    const gate::Json* inlineTree = input.get("tree");
    gate::Json fromFile;
    const gate::Json* source = inlineTree;
    if (source == nullptr) {
        if (treeFile.empty()) {
            err = "missing tree (inline or --tree)";
            return false;
        }
        const std::string text = readFile(treeFile);
        if (text.empty()) {
            err = "cannot read tree file: " + treeFile;
            return false;
        }
        if (!gate::parseJson(text, fromFile, err)) return false;
        source = &fromFile;
    }
    tree = gate::buildTree(*source, err);
    return tree != nullptr;
}

std::vector<std::string> toStringList(const gate::Json& value) {
    std::vector<std::string> out;
    if (value.type == gate::Json::Arr) {
        for (const gate::Json& item : value.items) {
            if (item.type == gate::Json::Str) out.push_back(item.s);
        }
    }
    return out;
}

void fillContext(const gate::Json& input, const std::vector<gate::Site>& sites, gate::Ctx& ctx) {
    ctx.sites = sites;
    ctx.url = input.getStr("url");
    ctx.installedSkills = toStringList(*input.get("skills"));
    const gate::Json* known = input.get("skillsKnown");
    ctx.skillsKnown = (known == nullptr) ? true : input.getBool("skillsKnown", true);
    const gate::Json* ready = input.get("pageReady");
    ctx.pageReady = (ready == nullptr) ? true : input.getBool("pageReady", true);
    std::string host;
    std::string path;
    if (gate::splitUrl(ctx.url, host, path)) {
        ctx.host = host;
        ctx.path = path;
    } else {
        ctx.reason = "invalid_url";
    }
}

int runCases(const std::string& casesFile, const std::string& sitesFile,
             const std::string& treeFile) {
    const std::string text = readFile(casesFile);
    if (text.empty()) return printError("cannot read cases file: " + casesFile);
    gate::Json cases;
    std::string err;
    if (!gate::parseJson(text, cases, err)) return printError("cases parse: " + err);

    const gate::Json* list = cases.type == gate::Json::Arr ? &cases : cases.get("cases");
    if (list == nullptr || list->type != gate::Json::Arr) return printError("cases: expected array");

    int failed = 0;
    int index = 0;
    for (const gate::Json& item : list->items) {
        ++index;
        const std::string name = item.getStr("name", "case-" + std::to_string(index));
        const gate::Json* inputPtr = item.get("input");
        gate::Json input = inputPtr != nullptr ? *inputPtr : gate::Json();
        gate::Json sitesJson;
        if (!sitesFile.empty()) gate::parseJson(readFile(sitesFile), sitesJson, err);
        std::vector<gate::Site> sites;
        if (!gate::parseSites(sitesJson, sites, err)) {
            std::cout << "FAIL " << name << " :: " << err << std::endl;
            ++failed;
            continue;
        }
        gate::NodePtr tree;
        if (!loadTree(input, treeFile, tree, err)) {
            std::cout << "FAIL " << name << " :: " << err << std::endl;
            ++failed;
            continue;
        }
        gate::Ctx ctx;
        fillContext(input, sites, ctx);
        if (ctx.reason != "invalid_url") gate::eval(*tree, ctx);

        const gate::Json* expect = item.get("expect");
        const std::string wantDecision = expect != nullptr ? expect->getStr("decision") : "";
        const std::string wantSite = expect != nullptr ? expect->getStr("site", "") : "";
        const bool decisionOk = wantDecision.empty() || ctx.decision == wantDecision;
        const bool siteOk = wantSite.empty() || (ctx.site != nullptr && ctx.site->id == wantSite);
        if (decisionOk && siteOk) {
            std::cout << "PASS " << name << " -> " << gate::resultJson(ctx) << std::endl;
        } else {
            std::cout << "FAIL " << name << " :: got " << gate::resultJson(ctx)
                      << " want decision=" << wantDecision
                      << (wantSite.empty() ? "" : " site=" + wantSite) << std::endl;
            ++failed;
        }
    }
    std::cout << (failed == 0 ? "ALL PASS" : "FAILED=" + std::to_string(failed)) << std::endl;
    return failed == 0 ? 0 : 1;
}

int runValidate(const std::string& sitesFile, const std::string& treeFile) {
    std::string err;
    gate::Json sitesJson;
    if (!gate::parseJson(readFile(sitesFile), sitesJson, err)) return printError("sites parse: " + err);
    std::vector<gate::Site> sites;
    if (!gate::parseSites(sitesJson, sites, err)) return printError("sites: " + err);

    gate::Json treeJson;
    if (!gate::parseJson(readFile(treeFile), treeJson, err)) return printError("tree parse: " + err);
    gate::NodePtr tree = gate::buildTree(treeJson, err);
    if (tree == nullptr) return printError("tree: " + err);
    if (!gate::validateTree(*tree, err)) return printError("tree: " + err);

    std::cout << "{\"ok\":true,\"sites\":" << sites.size() << "}" << std::endl;
    return 0;
}

int runJson(const std::string& sitesFile, const std::string& treeFile) {
    const std::string stdinText = readStdin();
    gate::Json input;
    std::string err;
    if (!gate::parseJson(stdinText, input, err)) return printError("input parse: " + err);

    std::vector<gate::Site> sites;
    if (!loadSites(input, sitesFile, sites, err)) return printError(err);
    gate::NodePtr tree;
    if (!loadTree(input, treeFile, tree, err)) return printError(err);

    gate::Ctx ctx;
    fillContext(input, sites, ctx);
    if (ctx.reason != "invalid_url") {
        gate::eval(*tree, ctx);
        if (ctx.decision == "ask_user" && ctx.reasons.empty()) {
            ctx.reason = "gate_not_passed";
        }
    }
    std::cout << gate::resultJson(ctx) << std::endl;
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string mode = "json";
    std::string sitesFile;
    std::string treeFile;
    std::string casesFile;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--json") mode = "json";
        else if (arg == "--validate") mode = "validate";
        else if (arg == "--cases" && i + 1 < argc) { mode = "cases"; casesFile = argv[++i]; }
        else if (arg == "--sites" && i + 1 < argc) sitesFile = argv[++i];
        else if (arg == "--tree" && i + 1 < argc) treeFile = argv[++i];
        else if (arg == "--help" || arg == "-h") {
            std::cout << "usage: site_gate [--json | --validate --sites F --tree F | --cases F --sites F --tree F]"
                      << std::endl;
            return 0;
        } else {
            return printError("unknown argument: " + arg);
        }
    }

    if (mode == "validate") return runValidate(sitesFile, treeFile);
    if (mode == "cases") return runCases(casesFile, sitesFile, treeFile);
    return runJson(sitesFile, treeFile);
}
