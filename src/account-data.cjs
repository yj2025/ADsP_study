function removeAccountData(db,id){
  for(const table of ['sessions','account_tokens','progress','content_uploads','content_imports']){
    db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
  }
  for(const table of ['content_lessons','content_questions']){
    db.prepare(`UPDATE ${table} SET reviewed_by=NULL WHERE reviewed_by=?`).run(id);
  }
  return db.prepare('DELETE FROM users WHERE id=?').run(id).changes;
}

module.exports={removeAccountData};
