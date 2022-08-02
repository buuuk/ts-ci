
import fetch from "node-fetch";
const urlJoin: typeof import("path").join = require("url-join");
import { setOutputFactory } from "./outputHelper";
import { NpmModuleVersion } from "./tools/NpmModuleVersion";
import { getActionParamsFactory } from "./inputHelper";
import { createOctokit } from "./tools/createOctokit";
import { getLatestSemVersionedTagFactory } from "./tools/octokit-addons/getLatestSemVersionedTag";

export const { getActionParams } = getActionParamsFactory({
    "inputNameSubset": [
        "owner",
        "repo",
        "branch",
        "github_token"
    ] as const
});

export type Params = ReturnType<typeof getActionParams>;

type CoreLike = {
    debug: (message: string) => void;
};

export const { setOutput } = setOutputFactory<"from_version" | "to_version" | "is_upgraded_version" | "is_release_beta">();

export async function action(
    _actionName: "is_package_json_version_upgraded",
    params: Params,
    core: CoreLike
): Promise<Parameters<typeof setOutput>[0]> {

    core.debug(JSON.stringify(params));

    const { owner, repo, github_token } = params;

    //params.branch <- github.head_ref || github.ref
    //When it's a normal branch: github.head_ref==="" and github.ref==="refs/heads/main"
    //When it's a pr from: github.head_ref==="<name of the branch branch>"
    const branch = params.branch.replace(/^refs\/heads\//, "");

    const to_version = await getPackageJsonVersion({ owner, repo, branch });

    if( to_version === undefined ){
        throw new Error(`No version in package.json on ${owner}/${repo}#${branch} (or repo is private)`);
    }


    core.debug(`Version on ${owner}/${repo}#${branch} is ${NpmModuleVersion.stringify(to_version)}`);

    const octokit = createOctokit({ github_token });

    const { getLatestSemVersionedTag } = getLatestSemVersionedTagFactory({ octokit });

    const { version: from_version } = await getLatestSemVersionedTag({ 
        owner, 
        repo, 
        "beta": to_version.betaPreRelease !== undefined ? 
            "ONLY LOOK FOR BETA" : "IGNORE BETA"
    })
        .then(wrap => wrap === undefined ? { "version": NpmModuleVersion.parse("0.0.0") } : wrap);

    core.debug(`Last version was ${NpmModuleVersion.stringify(from_version)}`);

    const is_upgraded_version = NpmModuleVersion.compare(
        to_version,
        from_version
    ) === 1 ? "true" : "false";

    core.debug(`Is version upgraded: ${is_upgraded_version}`);

    const is_release_beta= is_upgraded_version === "false" ? "false" : to_version.betaPreRelease !== undefined ? "true" : "false";

    core.debug(`Is release beta: ${is_release_beta}`);

    return {
        "to_version": NpmModuleVersion.stringify(to_version),
        "from_version": NpmModuleVersion.stringify(from_version),
        is_upgraded_version,
        is_release_beta
    };

}

//TODO: Find a way to make it work with private repo
async function getPackageJsonVersion(params: {
    owner: string;
    repo: string;
    branch: string;
}): Promise<NpmModuleVersion | undefined> {

    const { owner, repo, branch } = params;

    const version = await fetch(
        urlJoin(
            `https://raw.github.com`,
            owner,
            repo,
            branch,
            "package.json"
        )
    )
        .then(res => res.text())
        .then(text => JSON.parse(text))
        .then(({ version }) => version as string)
        .catch(()=> undefined)
        ;

    if( version === undefined){
        return undefined;
    }

    return NpmModuleVersion.parse(version);

}

