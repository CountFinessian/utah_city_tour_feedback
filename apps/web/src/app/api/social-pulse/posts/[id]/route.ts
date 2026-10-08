import { NextResponse } from "next/server";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { isRejectedRelevance } from "@/domain/social-listening/relevance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repo = getSocialRepository();
    const post = await repo.getPost(id);

    if (!post || isRejectedRelevance(post.relevanceStatus)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const comments = await repo.listComments({ postId: id });
    const snapshots = await repo.listSnapshots(id);

    return NextResponse.json({ post, comments, snapshots });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

